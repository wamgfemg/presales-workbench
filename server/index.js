'use strict'
/**
 * 售前解决方案工作台 · BFF
 * - 托管前端静态文件（无需 Nginx）
 * - /api/chat 以 SSE 流式代理 Hermes Agent（profile=wordpresales）
 * - 新增 /api/sessions：返回 Hermes wordpresales 历史会话，与本地任务对齐
 * - 新增 /api/session/attach：把前端任务绑定到已有 Hermes session
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

/* ---------------- Hermes 通用：拿会话列表 ---------------- */
async function hermesCookie() {
  const url = process.env.HERMES_URL || 'http://127.0.0.1:9119'
  const user = process.env.HERMES_USER || 'admin'
  const pass = process.env.HERMES_PASS || ''
  const r = await fetch(`${url}/auth/password-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass, provider: 'basic' }),
  })
  if (!r.ok) throw new Error(`Hermes 登录失败 HTTP ${r.status}`)
  let list = []
  if (typeof r.headers.getSetCookie === 'function') list = r.headers.getSetCookie()
  if (!list || !list.length) {
    const one = r.headers.get('set-cookie')
    list = one ? [one] : []
  }
  const cookie = list.map((s) => String(s).split(';')[0]).filter(Boolean).join('; ')
  if (!cookie) throw new Error('Hermes 登录未返回 Cookie')
  return cookie
}

async function hermesSessions() {
  const url = process.env.HERMES_URL || 'http://127.0.0.1:9119'
  const profile = process.env.HERMES_PROFILE || 'wordpresales'
  const cookie = await hermesCookie()
  const r = await fetch(`${url}/api/sessions`, { headers: { cookie } })
  if (!r.ok) throw new Error(`Hermes /api/sessions 失败 HTTP ${r.status}`)
  const data = await r.json()
  const sessions = (data.sessions || []).filter((s) => s.profile === profile)
  return sessions
}

/* ---------------- SSE 对话 ---------------- */
async function handleChat(req, res) {
  let body
  try { body = await readBody(req) } catch (e) { return sendJson(res, 400, { error: e.message }) }

  const key = String(body.key || body.taskId || 'default').slice(0, 64)
  const text = String(body.text || '').trim()
  const reset = !!body.reset
  const sessionId = body.sessionId ? String(body.sessionId).slice(0, 64) : null
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

  const attempt = async (isRetry, preferredSessionId) => {
    const sess = pool.get(key, preferredSessionId)
    if (!sess.connected) {
      send({ type: 'status', text: isRetry ? '会话已失效，正在重建…' : '正在连接专家智能体…' })
      const info = await sess.open(preferredSessionId)
      send({ type: 'session', sessionId: sess.sessionId, storedSessionId: sess.storedSessionId, model: sess.model })
      if (info && info.sessionId) {
        pool.recordSession(key, sess.sessionId, sess.storedSessionId)
      }
    }
    return sess.submit(text, (ev) => send(ev))
  }

  try {
    let result
    try {
      result = await attempt(false, sessionId)
    } catch (e1) {
      const msg = String(e1 && e1.message || e1)
      const retryable = /session not found|WebSocket|未连接|已断开|断开|超时|closed|ECONN|fetch failed/i.test(msg)
      if (!retryable) throw e1
      log('第一次提交失败，重建会话重试：', msg)
      pool.drop(key)
      result = await attempt(true, null)
    }
    // 记录本次使用的 session 映射
    pool.recordSession(key, result.sessionId, result.storedSessionId)
    send({ type: 'done', text: result.text || '', status: result.status || 'complete', usage: result.usage || null, sessionId: result.sessionId, storedSessionId: result.storedSessionId })
  } catch (err) {
    log('对话失败:', err && err.message)
    send({ type: 'error', message: String(err && err.message || err) })
  } finally {
    clearInterval(beat)
    if (!closed) { try { res.end() } catch (_) {} }
  }
}

/* ---------------- Hermes 历史会话列表 ---------------- */
async function handleSessions(req, res) {
  try {
    const sessions = await hermesSessions()
    const localMap = pool.listMap()
    const byLong = new Map()
    for (const it of localMap) {
      if (it.longId) byLong.set(it.longId, it)
    }
    const list = sessions.map((s) => {
      const local = byLong.get(s.id) || null
      return {
        id: s.id,                       // long id（与 Hermes 历史列表一致）
        shortId: local ? local.shortId : null,
        localKey: local ? local.key : null,
        preview: s.preview || '',
        title: s.title || null,
        messageCount: s.message_count || 0,
        inputTokens: s.input_tokens || 0,
        outputTokens: s.output_tokens || 0,
        model: s.model || null,
        profile: s.profile || null,
        startedAt: s.started_at ? new Date(s.started_at * 1000).toISOString() : null,
        lastActiveAt: s.last_active ? new Date(s.last_active * 1000).toISOString() : null,
        isActive: !!s.is_active,
        archived: !!s.archived,
      }
    })
    return sendJson(res, 200, { ok: true, profile: process.env.HERMES_PROFILE || 'wordpresales', count: list.length, sessions: list, localMap })
  } catch (err) {
    log('获取 Hermes 会话列表失败:', err && err.message)
    return sendJson(res, 502, { ok: false, error: String(err && err.message || err) })
  }
}

/* ---------------- 绑定已有 Hermes session 到前端任务 ---------------- */
async function handleAttach(req, res) {
  let body
  try { body = await readBody(req) } catch (e) { return sendJson(res, 400, { error: e.message }) }
  const key = String(body.key || body.taskId || '').slice(0, 64)
  const shortId = body.shortId ? String(body.shortId).slice(0, 64) : null
  const longId = body.longId ? String(body.longId).slice(0, 128) : null
  if (!key || !shortId) return sendJson(res, 400, { error: 'key 与 shortId 必填' })
  pool.attach(key, shortId, longId)
  pool.drop(key) // 强制下次 get 时重建连接并复用 shortId
  return sendJson(res, 200, { ok: true, key, shortId, longId })
}

/* ---------------- WeKnora 代理 ---------------- */
const WEKNORA_URL = process.env.WEKNORA_URL || 'http://127.0.0.1:8080'
const WEKNORA_API_KEY = process.env.WEKNORA_API_KEY || ''
const WEKNORA_KB_ID = process.env.WEKNORA_KB_ID || ''
const WEKNORA_ENABLED = !!(WEKNORA_API_KEY && WEKNORA_KB_ID)

function proxyToWeKnora(req, res, targetPath, search) {
  if (!WEKNORA_ENABLED) return sendJson(res, 503, { error: 'WeKnora 未配置' })
  const base = new URL(WEKNORA_URL)
  const qs = search || ''
  const options = {
    protocol: base.protocol,
    hostname: base.hostname,
    port: base.port || (base.protocol === 'https:' ? 443 : 80),
    path: `/api/v1${targetPath}${qs}`,
    method: req.method,
    headers: { ...req.headers, 'x-api-key': WEKNORA_API_KEY },
  }
  delete options.headers.host
  delete options.headers.connection
  delete options.headers['content-length'] // 让 Node 根据实际 body 重新计算

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers)
    proxyRes.pipe(res)
  })
  proxyReq.on('error', (err) => {
    log('WeKnora 代理失败:', err && err.message)
    if (!res.headersSent) sendJson(res, 502, { error: 'WeKnora 代理失败: ' + (err && err.message) })
    else { try { res.end() } catch (_) {} }
  })
  req.pipe(proxyReq)
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
    weknoraEnabled: WEKNORA_ENABLED,
    weknoraKbId: WEKNORA_KB_ID || null,
    pool: pool.stats(),
    memoryMB: Math.round(process.memoryUsage().rss / 1048576),
    node: process.version,
  }
  try {
    const r = await fetch(out.hermesUrl + '/', { method: 'GET' })
    out.hermesReachable = r.status
  } catch (e) { out.hermesReachable = 'unreachable: ' + (e && e.message) }
  if (WEKNORA_ENABLED) {
    try {
      const r = await fetch(`${WEKNORA_URL}/api/v1/knowledge-bases/${WEKNORA_KB_ID}`, { headers: { 'x-api-key': WEKNORA_API_KEY } })
      out.weknoraReachable = r.status
    } catch (e) { out.weknoraReachable = 'unreachable: ' + (e && e.message) }
  }
  sendJson(res, 200, out)
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = req.url || '/'
  try {
    if (url.startsWith('/api/chat') && req.method === 'POST') return void (await handleChat(req, res))
    if (url.startsWith('/api/sessions') && req.method === 'GET') return void (await handleSessions(req, res))
    if (url.startsWith('/api/session/attach') && req.method === 'POST') return void (await handleAttach(req, res))
    if (url.startsWith('/api/health')) return void (await handleHealth(req, res))

    /* WeKnora 代理：前端通过 BFF 间接访问 WeKnora，避免暴露 API Key 与 8080 端口 */
    if (url.startsWith('/api/weknora/knowledge-base') && req.method === 'GET') {
      return proxyToWeKnora(req, res, `/knowledge-bases/${WEKNORA_KB_ID}`)
    }
    if (url.startsWith('/api/weknora/knowledge') && req.method === 'GET') {
      const search = url.replace(/^\/api\/weknora\/knowledge/, '')
      return proxyToWeKnora(req, res, `/knowledge-bases/${WEKNORA_KB_ID}/knowledge`, search)
    }
    if (url.startsWith('/api/weknora/upload') && req.method === 'POST') {
      return proxyToWeKnora(req, res, `/knowledge-bases/${WEKNORA_KB_ID}/knowledge/file`)
    }
    if (url.startsWith('/api/weknora/knowledge/') && req.method === 'DELETE') {
      const itemId = decodeURIComponent(url.slice('/api/weknora/knowledge/'.length).split('?')[0])
      if (!itemId) return sendJson(res, 400, { error: '缺少文档 ID' })
      return proxyToWeKnora(req, res, `/knowledge/${itemId}`)
    }

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
  log(`WeKnora: ${WEKNORA_ENABLED ? '已启用 KB=' + WEKNORA_KB_ID : '未配置'}`)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { log('收到', sig, '，退出'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000) })
}
process.on('unhandledRejection', (e) => log('unhandledRejection:', e && e.message || e))
