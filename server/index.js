'use strict'
/**
 * 售前解决方案工作台 · BFF
 * - 托管前端静态文件（无需 Nginx）
 * - /api/chat 以 SSE 流式代理 Hermes Agent（profile=wordpresales）
 * - 零第三方依赖：仅用 Node 内置模块 + Node22 全局 fetch/WebSocket
 *
 * 前端永不直连 Hermes，凭证只存在于本进程的环境变量中。
 */

const http = require('node:http')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { HermesPool } = require('./hermes.js')

const PORT = Number(process.env.PORT || 8088)
const HOST = process.env.BIND_HOST || '0.0.0.0'
const FRONT_DIR = path.resolve(process.env.FRONT_DIR || path.join(__dirname, '..', 'frontend'))
const MAX_BODY = 2 * 1024 * 1024

const pool = new HermesPool()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

function log(...a) { console.log(new Date().toISOString(), ...a) }

function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8')
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) { reject(new Error('请求体过大')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch (e) { reject(new Error('请求体不是合法 JSON')) }
    })
    req.on('error', reject)
  })
}

/* ---------------- 静态文件 ---------------- */
async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0])
  if (rel === '/' || rel === '') rel = '/index.html'
  const full = path.resolve(path.join(FRONT_DIR, rel))
  if (!full.startsWith(FRONT_DIR)) { res.writeHead(403).end('forbidden'); return }

  let st
  try { st = await fsp.stat(full) } catch (_) {
    // 单页应用兜底
    try {
      const idx = path.join(FRONT_DIR, 'index.html')
      const buf = await fsp.readFile(idx)
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' })
      res.end(buf)
    } catch (_) { res.writeHead(404).end('not found') }
    return
  }
  if (st.isDirectory()) return serveStatic(req, res, path.posix.join(rel, 'index.html'))

  const ext = path.extname(full).toLowerCase()
  const etag = `W/"${st.size}-${Number(st.mtimeMs).toString(36)}"`
  if (req.headers['if-none-match'] === etag) { res.writeHead(304).end(); return }
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': st.size,
    etag,
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
  })
  fs.createReadStream(full).pipe(res)
}

/* ---------------- SSE 对话 ---------------- */
async function handleChat(req, res) {
  let body
  try { body = await readBody(req) } catch (e) { return sendJson(res, 400, { error: e.message }) }

  const key = String(body.key || body.taskId || 'default').slice(0, 64)
  const text = String(body.text || '').trim()
  const reset = !!body.reset
  if (!text) return sendJson(res, 400, { error: 'text 不能为空' })

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.write(': open\n\n')

  let closed = false
  req.on('close', () => { closed = true })
  const send = (obj) => {
    if (closed) return
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`) } catch (_) { closed = true }
  }
  const beat = setInterval(() => { if (!closed) { try { res.write(': ping\n\n') } catch (_) {} } }, 15000)

  if (reset) pool.drop(key)

  const attempt = async (isRetry) => {
    const sess = pool.get(key)
    if (!sess.connected) {
      send({ type: 'status', text: isRetry ? '会话已失效，正在重建…' : '正在连接专家智能体…' })
      await sess.open()
      send({ type: 'session', sessionId: sess.sessionId, model: sess.model })
    }
    return sess.submit(text, (ev) => send(ev))
  }

  try {
    let result
    try {
      result = await attempt(false)
    } catch (e1) {
      const msg = String(e1 && e1.message || e1)
      const retryable = /session not found|WebSocket|未连接|已断开|断开|超时|closed|ECONN|fetch failed/i.test(msg)
      if (!retryable) throw e1
      log('第一次提交失败，重建会话重试：', msg)
      pool.drop(key)
      result = await attempt(true)
    }
    send({ type: 'done', text: result.text || '', status: result.status || 'complete', usage: result.usage || null })
  } catch (err) {
    log('对话失败:', err && err.message)
    send({ type: 'error', message: String(err && err.message || err) })
  } finally {
    clearInterval(beat)
    if (!closed) { try { res.end() } catch (_) {} }
  }
}

/* ---------------- 健康检查 ---------------- */
async function handleHealth(req, res) {
  const out = {
    ok: true,
    time: new Date().toISOString(),
    port: PORT,
    frontDir: FRONT_DIR,
    profile: process.env.HERMES_PROFILE || 'wordpresales',
    hermesUrl: process.env.HERMES_URL || 'http://127.0.0.1:9119',
    pool: pool.stats(),
    memoryMB: Math.round(process.memoryUsage().rss / 1048576),
    node: process.version,
  }
  try {
    const r = await fetch(out.hermesUrl + '/', { method: 'GET' })
    out.hermesReachable = r.status
  } catch (e) { out.hermesReachable = 'unreachable: ' + (e && e.message) }
  sendJson(res, 200, out)
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = req.url || '/'
  try {
    if (url.startsWith('/api/chat') && req.method === 'POST') return void (await handleChat(req, res))
    if (url.startsWith('/api/health')) return void (await handleHealth(req, res))
    if (url.startsWith('/api/reset') && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}))
      pool.drop(String(b.key || b.taskId || 'default').slice(0, 64))
      return sendJson(res, 200, { ok: true })
    }
    if (url.startsWith('/api/')) return sendJson(res, 404, { error: 'no such api' })
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' })
    return void (await serveStatic(req, res, url))
  } catch (e) {
    log('未捕获错误:', e && e.stack || e)
    if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' })
    else { try { res.end() } catch (_) {} }
  }
})

server.keepAliveTimeout = 65000
server.headersTimeout = 70000
server.requestTimeout = 0   // SSE 长连接不设请求超时

server.listen(PORT, HOST, () => {
  log(`售前工作台 BFF 已启动  http://${HOST}:${PORT}`)
  log(`静态目录: ${FRONT_DIR}`)
  log(`Hermes: ${process.env.HERMES_URL || 'http://127.0.0.1:9119'}  profile=${process.env.HERMES_PROFILE || 'wordpresales'}`)
  if (!process.env.HERMES_PASS) log('警告：未设置 HERMES_PASS，对话将无法鉴权')
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { log('收到', sig, '，退出'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000) })
}
process.on('unhandledRejection', (e) => log('unhandledRejection:', e && e.message || e))
