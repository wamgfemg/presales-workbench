'use strict'
/**
 * 售前解决方案工作台 · BFF
 * - 托管前端静态文件（无需 Nginx）
 * - /api/chat 以 SSE 流式代理 Hermes Agent（profile=wordpresales）
 * - 异步任务层：SSE 断开后后台任务继续运行，前端可轮询 /api/chat/poll/:taskId
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
const { HermesPool, hermesCookieCached, invalidateCookieCache } = require('./hermes.js')
const { extractText } = require('./extract.js')
const { createTask, getTask, findRunning, stats: taskStats } = require('./async-task.js')

const PORT = Number(process.env.PORT || 8088)
const HOST = process.env.BIND_HOST || '0.0.0.0'
const FRONT_DIR = path.resolve(process.env.FRONT_DIR || path.join(__dirname, '..', 'frontend'))
const MAX_BODY = 2 * 1024 * 1024
const MAX_ATTACHMENT = 10 * 1024 * 1024
const MAX_ATTACH_CHARS = Number(process.env.MAX_ATTACH_CHARS || 80000)
const HEALTH_TTL_MS = Number(process.env.HEALTH_TTL_MS || 15000)
const WEKNORA_TIMEOUT_MS = Number(process.env.WEKNORA_TIMEOUT_MS || 30000)
const HERMES_TIMEOUT_MS = Number(process.env.HERMES_TIMEOUT_MS || 20000)
const DATA_DIR = process.env.DATA_DIR || '/opt/presales-workbench/data'
const FILE_DIR = path.join(DATA_DIR, 'files')
const FILES_INDEX = path.join(DATA_DIR, 'files-index.json')

let _healthCache = { at: 0, data: null }
let _filesIndex = (() => {
  try { return JSON.parse(fs.readFileSync(FILES_INDEX, 'utf8') || '{}') } catch (_) { return {} }
})()
function saveFilesIndex() {
  try {
    fs.mkdirSync(path.dirname(FILES_INDEX), { recursive: true })
    fs.writeFileSync(FILES_INDEX, JSON.stringify(_filesIndex, null, 2), 'utf8')
  } catch (e) { log('保存 files-index 失败:', e && e.message) }
}

function fetchWithTimeout(url, opts = {}, ms = HERMES_TIMEOUT_MS) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(t))
}

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

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return }
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
  const etag = `W/"${st.size}-${Number(st.mtimeMs).toString(36)}`
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
async function hermesSessions() {
  const url = process.env.HERMES_URL || 'http://127.0.0.1:9119'
  const profile = process.env.HERMES_PROFILE || 'wordpresales'
  const cookie = await hermesCookieCached()
  const r = await fetchWithTimeout(`${url}/api/sessions`, { headers: { cookie } }, HERMES_TIMEOUT_MS)
  if (!r.ok) {
    if (r.status === 401) invalidateCookieCache()
    throw new Error(`Hermes /api/sessions 失败 HTTP ${r.status}`)
  }
  const data = await r.json()
  const sessions = (data.sessions || []).filter((s) => s.profile === profile)
  return sessions
}

/* ---------------- SSE 对话（异步后台任务 + SSE 实时流 + 断线轮询兜底） ---------------- */
async function handleChat(req, res) {
  let body
  try { body = await readBody(req) } catch (e) { return sendJson(res, 400, { error: e.message }) }

  const key = String(body.key || body.taskId || 'default').slice(0, 64)
  const rawText = String(body.text || '').trim()
  const attachments = Array.isArray(body.attachments) ? body.attachments : []
  const reset = !!body.reset
  const sessionId = body.sessionId ? String(body.sessionId).slice(0, 64) : null
  let promptText = rawText
  if (attachments.length) {
    const parts = attachments
      .filter((a) => a && typeof a.text === 'string' && a.text.trim())
      .map((a) => {
        let txt = a.text.trim()
        if (txt.length > MAX_ATTACH_CHARS) txt = txt.slice(0, MAX_ATTACH_CHARS) + '\n\n…（文件内容已截断，后续内容省略）'
        return `【已上传文件：${a.name || '未命名'}】\n${txt}`
      })
    if (parts.length) promptText = parts.join('\n\n---\n\n') + '\n\n---\n\n' + (promptText || '请基于以上文件内容进行分析。')
  }
  const text = promptText.trim()
  if (!text) return sendJson(res, 400, { error: 'text 不能为空' })

  // 检查是否已有进行中的任务（防止重复提交）
  const existing = findRunning(key)
  let task
  if (existing && !reset) {
    task = existing
    log(`任务 ${task.id} 已在运行中，复用（key=${key}）`)
  } else {
    task = createTask(pool, key, text, { sessionId, reset })
    log(`创建后台任务 ${task.id}（key=${key}）`)
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.write(': open\n\n')

  let closed = false
  const cleanup = () => { clearInterval(beat); clearInterval(streamTimer) }
  req.on('close', () => { closed = true; cleanup() })
  const send = (obj) => {
    if (closed) return
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`) } catch (_) { closed = true }
  }
  const beat = setInterval(() => { if (!closed) { try { res.write(': ping\n\n') } catch (_) {} } }, 15000)

  // 立即发送 taskId，前端可用于断线后轮询
  send({ type: 'task', taskId: task.id })
  send({ type: 'status', text: task.status === 'processing' ? '正在连接专家智能体…' : '任务已完成' })

  // 从后台任务流式转发事件到 SSE
  let lastSentIdx = 0
  const streamTimer = setInterval(() => {
    if (closed) return

    // 发送尚未推送的事件
    while (lastSentIdx < task.events.length) {
      send(task.events[lastSentIdx])
      lastSentIdx++
    }

    // 检查完成状态
    if (task.status === 'done') {
      send({ type: 'done', text: task.result, status: 'complete', sessionId: task.sessionId, storedSessionId: task.storedSessionId })
      cleanup()
      if (!closed) { try { res.end() } catch (_) {} }
    } else if (task.status === 'error') {
      send({ type: 'error', message: task.error || '未知错误' })
      cleanup()
      if (!closed) { try { res.end() } catch (_) {} }
    }
  }, 500)
}

/* ---------------- 轮询任务状态（SSE 断线后的兜底通道） ---------------- */
async function handlePoll(req, res, taskId) {
  const task = getTask(taskId)
  if (!task) return sendJson(res, 404, { error: '任务不存在或已过期' })

  const recentEvents = task.events.slice(-50)
  return sendJson(res, 200, {
    taskId: task.id,
    status: task.status,
    text: task.result,
    events: recentEvents,
    error: task.error,
    sessionId: task.sessionId,
    storedSessionId: task.storedSessionId,
    model: task.model,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  })
}

/* ---------------- 聊天文件附件：提取文本 ---------------- */
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function handleExtract(req, res) {
  const ct = String(req.headers['content-type'] || '')
  let name = ''
  let buf
  try {
    if (ct.includes('application/octet-stream')) {
      name = decodeURIComponent(String(req.headers['x-filename'] || '').trim())
      buf = await readRaw(req, MAX_ATTACHMENT)
    } else {
      const body = await readBody(req, MAX_ATTACHMENT)
      name = String(body.name || '').trim()
      const base64 = String(body.base64 || body.data || '')
      if (!base64) return sendJson(res, 400, { error: '缺少文件内容' })
      buf = Buffer.from(base64, 'base64')
    }
  } catch (e) {
    return sendJson(res, 413, { error: '上传被拦截或文件过大：' + e.message + '。建议压缩文件、转成 .docx 后重试，或直接把文本粘贴到输入框。' })
  }
  if (!name) return sendJson(res, 400, { error: '缺少文件名' })
  if (!buf || !buf.length) return sendJson(res, 400, { error: '文件内容为空' })
  const MAX_MB = 8
  if (buf.length > MAX_MB * 1024 * 1024) {
    return sendJson(res, 413, { error: `文件超过 ${MAX_MB}MB 上限。请压缩后重试，或把正文文本直接粘贴到输入框交给 Hermes 分析。` })
  }
  try {
    const out = extractText(name, buf)
    if (!out.ok) return sendJson(res, 415, { ok: false, error: out.error })
    return sendJson(res, 200, { ok: true, name: out.name, ext: out.ext, chars: out.chars, text: out.text })
  } catch (e) {
    log('提取文件内容失败:', name, e && e.message)
    return sendJson(res, 500, { ok: false, error: '提取内容失败：' + (e && e.message || e) })
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
        id: s.id,
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
  pool.drop(key)
  return sendJson(res, 200, { ok: true, key, shortId, longId })
}

/* ---------------- WeKnora 代理 ---------------- */
const WEKNORA_URL = process.env.WEKNORA_URL || 'http://127.0.0.1:8080'
const WEKNORA_API_KEY = process.env.WEKNORA_API_KEY || ''
const WEKNORA_KB_ID = process.env.WEKNORA_KB_ID || ''
const WEKNORA_ENABLED = !!(WEKNORA_API_KEY && WEKNORA_KB_ID)

let _kbAllow = { at: 0, set: null }
async function kbAllowed() {
  if (_kbAllow.set && Date.now() - _kbAllow.at < 60000) return _kbAllow.set
  const set = new Set()
  try {
    const r = await fetchWithTimeout(`${WEKNORA_URL}/api/v1/knowledge-bases`, { headers: { 'x-api-key': WEKNORA_API_KEY } }, WEKNORA_TIMEOUT_MS)
    const j = await r.json()
    for (const x of (j.data || [])) if (x && x.id) set.add(x.id)
  } catch (e) {
    log('拉取 WeKnora 知识库列表失败：', e && e.message)
  }
  if (WEKNORA_KB_ID) set.add(WEKNORA_KB_ID)
  _kbAllow = { at: Date.now(), set }
  return set
}
async function pickKb(sp) {
  const want = sp ? String(sp.get('kb') || '') : ''
  if (!want || want === WEKNORA_KB_ID) return WEKNORA_KB_ID
  const allow = await kbAllowed()
  if (allow.has(want)) return want
  log(`忽略越权的 kb 参数 ${String(want).slice(0, 40)}，回退默认库`)
  return WEKNORA_KB_ID
}

function proxyToWeKnora(req, res, targetPath, search, opts) {
  if (!WEKNORA_ENABLED) return sendJson(res, 503, { error: 'WeKnora 未配置' })
  opts = opts || {}
  const base = new URL(WEKNORA_URL)
  const qs = search || ''
  const options = {
    protocol: base.protocol,
    hostname: base.hostname,
    port: base.port || (base.protocol === 'https:' ? 443 : 80),
    path: `/api/v1${targetPath}${qs}`,
    method: req.method,
    headers: { ...req.headers, 'x-api-key': WEKNORA_API_KEY },
    timeout: WEKNORA_TIMEOUT_MS,
  }
  delete options.headers.host
  delete options.headers.connection
  delete options.headers['content-length']

  const proxyReq = http.request(options, (proxyRes) => {
    const h = opts.disposition ? Object.assign({}, proxyRes.headers, { 'content-disposition': opts.disposition }) : proxyRes.headers
    res.writeHead(proxyRes.statusCode, h)
    proxyRes.pipe(res)
  })
  proxyReq.on('timeout', () => {
    log('WeKnora 代理超时')
    proxyReq.destroy(new Error('WeKnora 请求超时'))
  })
  proxyReq.on('error', (err) => {
    log('WeKnora 代理失败:', err && err.message)
    if (!res.headersSent) sendJson(res, 502, { error: 'WeKnora 代理失败: ' + (err && err.message) })
    else { try { res.end() } catch (_) {} }
  })
  req.pipe(proxyReq)
}

/* ---------------- 文档目录归属映射 ---------------- */
const CATMAP_FILE = path.join(DATA_DIR, 'kb-catmap.json')
let _catMap = (() => { try { return JSON.parse(fs.readFileSync(CATMAP_FILE, 'utf8') || '{}') || {} } catch (_) { return {} } })()
function saveCatMap() {
  try {
    fs.mkdirSync(path.dirname(CATMAP_FILE), { recursive: true })
    fs.writeFileSync(CATMAP_FILE, JSON.stringify(_catMap), 'utf8')
  } catch (e) { log('保存 kb-catmap 失败:', e && e.message) }
}
async function handleCatMapGet(req, res) {
  return sendJson(res, 200, { ok: true, map: _catMap })
}
async function handleCatMapPut(req, res) {
  let body
  try { body = await readBody(req) } catch (e) { return sendJson(res, 400, { error: e.message }) }
  const docId = String(body.docId || '').trim()
  if (!docId) return sendJson(res, 400, { error: 'docId 必填' })
  const catId = body.catId ? String(body.catId).trim() : null
  if (catId) _catMap[docId] = catId
  else delete _catMap[docId]
  saveCatMap()
  return sendJson(res, 200, { ok: true, docId, catId })
}

/* ---------------- 工作台业务数据落库（SQLite） ---------------- */
const DB = require('./db.js')
const STATE_FILE = path.join(DATA_DIR, process.env.DB_FILE || 'presales.db')
const MAX_STATE_BODY = Number(process.env.MAX_STATE_BODY || 16 * 1024 * 1024)
let _dbReady = false
try {
  DB.init(STATE_FILE)
  _dbReady = true
  log('SQLite 就绪:', STATE_FILE, JSON.stringify(DB.info()))
} catch (e) {
  log('!! SQLite 初始化失败（/api/state 返回 503，前端自动退回浏览器本地模式）:', e && e.message)
}

function dbUnavailable(res) {
  return sendJson(res, 503, { error: '数据库不可用', detail: 'SQLite 未就绪，前端将退回浏览器本地模式' })
}

async function handleStateList(req, res, sp) {
  if (!_dbReady) return dbUnavailable(res)
  const metaOnly = !!(sp && sp.get('meta'))
  const keysParam = sp ? sp.get('keys') : null
  let states
  if (keysParam) {
    states = {}
    for (const raw of String(keysParam).split(',')) {
      const k = raw.trim()
      if (!k) continue
      try { const row = DB.get(k, !metaOnly); if (row) states[k] = row } catch (_) {}
    }
  } else {
    states = DB.listAll(!metaOnly)
  }
  return sendJson(res, 200, { ok: true, states, meta: metaOnly, db: DB.info() })
}

async function handleStateGet(req, res, key) {
  if (!_dbReady) return dbUnavailable(res)
  let row
  try { row = DB.get(key) } catch (e) { return sendJson(res, 400, { error: e.message }) }
  if (!row) return sendJson(res, 404, { error: '集合不存在', key })
  return sendJson(res, 200, { ok: true, key, ...row })
}

async function handleStatePut(req, res, key) {
  if (!_dbReady) return dbUnavailable(res)
  let body
  try { body = await readBody(req, MAX_STATE_BODY) } catch (e) { return sendJson(res, 400, { error: e.message }) }
  if (body.data === undefined) return sendJson(res, 400, { error: 'data 必填' })
  let r
  try { r = DB.put(key, body.data, { rev: body.rev, force: !!body.force, by: body.by }) }
  catch (e) { return sendJson(res, 400, { error: e.message }) }
  if (r.conflict) {
    log(`state 冲突 ${key}：客户端想用 rev=${body.rev}，服务端已是 rev=${r.rev}（上次由 ${r.updated_by || '-'} 于 ${new Date(r.updated_at).toISOString()} 写入）`)
    return sendJson(res, 409, { error: 'rev_conflict', key, ...r })
  }
  return sendJson(res, 200, { ok: true, ...r })
}

async function handleStateImport(req, res) {
  if (!_dbReady) return dbUnavailable(res)
  let body
  try { body = await readBody(req, MAX_STATE_BODY) } catch (e) { return sendJson(res, 400, { error: e.message }) }
  const states = body.states
  if (!states || typeof states !== 'object' || Array.isArray(states)) return sendJson(res, 400, { error: 'states 必须是对象' })
  const out = DB.putMany(states, { by: body.by, force: true })
  log(`state 批量写入 ${out.written.length} 个集合${out.conflicts.length ? '，跳过冲突 ' + out.conflicts.length + ' 个' : ''}`)
  return sendJson(res, 200, { ok: true, ...out, db: DB.info() })
}

async function handleStateDelete(req, res, key) {
  if (!_dbReady) return dbUnavailable(res)
  try { return sendJson(res, 200, { ok: true, ...DB.remove(key) }) }
  catch (e) { return sendJson(res, 400, { error: e.message }) }
}

/* ---------------- 通用文件上传/下载 ---------------- */
const MAX_DB_FILE = Number(process.env.MAX_DB_FILE || 32 * 1024 * 1024)
async function handleFileUpload(req, res) {
  let name = ''
  let buf
  try {
    name = decodeURIComponent(String(req.headers['x-filename'] || '').trim())
    buf = await readRaw(req, MAX_DB_FILE)
  } catch (e) {
    return sendJson(res, 413, { error: `文件过大或上传失败：${e.message}。单个文件上限 ${Math.round(MAX_DB_FILE / 1048576)}MB，建议压缩或拆分后重试。` })
  }
  if (!name) return sendJson(res, 400, { error: '缺少文件名' })
  if (!buf || !buf.length) return sendJson(res, 400, { error: '文件内容为空' })
  const fileId = uid() + path.extname(name).toLowerCase()
  const scope = decodeURIComponent(String(req.headers['x-scope'] || '').trim()).slice(0, 127)
  try {
    const out = DB.putFile({ id: fileId, name, mime: mimeFromName(name), scope, buf })
    return sendJson(res, 200, { ...out, stored: 'sqlite' })
  } catch (e) {
    log('资料入库失败:', e && e.message)
    return sendJson(res, 500, { error: '保存文件失败：' + e.message })
  }
}
function mimeFromName(name) {
  const ext = path.extname(name).toLowerCase()
  const map = {
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.txt': 'text/plain; charset=utf-8',
  }
  return map[ext] || 'application/octet-stream'
}
function sendFileBuf(res, buf, mime, name) {
  res.writeHead(200, {
    'content-type': mime || 'application/octet-stream',
    'content-length': buf.length,
    'content-disposition': `attachment; filename="${encodeURIComponent(name || 'file')}"`,
  })
  res.end(buf)
}
async function handleFileDownload(req, res, fileId) {
  if (!fileId) return sendJson(res, 400, { error: '缺少文件 ID' })
  if (_dbReady) {
    const f = DB.getFile(fileId)
    if (f) return sendFileBuf(res, f.buf, f.mime, f.name)
  }
  const meta = _filesIndex[fileId]
  try {
    const buf = fs.readFileSync(path.join(FILE_DIR, fileId))
    return sendFileBuf(res, buf, meta && meta.mime, meta && meta.name ? meta.name : fileId)
  } catch (e) {
    return sendJson(res, 404, { error: '文件不存在或已删除' })
  }
}
async function handleFileDelete(req, res, fileId) {
  if (!fileId) return sendJson(res, 400, { error: '缺少文件 ID' })
  let deleted = false
  if (_dbReady) { try { deleted = DB.delFile(fileId).deleted } catch (e) { return sendJson(res, 400, { error: e.message }) } }
  if (!deleted) {
    try { fs.unlinkSync(path.join(FILE_DIR, fileId)); deleted = true } catch (_) {}
    if (_filesIndex[fileId]) { delete _filesIndex[fileId]; saveFilesIndex() }
  }
  return sendJson(res, 200, { ok: true, fileId, deleted })
}
async function handleFileList(req, res, sp) {
  if (!_dbReady) return dbUnavailable(res)
  const scope = decodeURIComponent(String((sp && sp.get('scope')) || '')).slice(0, 127)
  const files = DB.listFiles(scope)
  for (const [id, m] of Object.entries(_filesIndex)) {
    if (files.some(f => f.fileId === id)) continue
    if (scope && String(id).indexOf(scope) !== 0) continue
    files.push({ fileId: id, name: m.name, mime: m.mime, size: m.size, scope: '', created_at: Date.parse(m.created || '') || 0, stored: 'disk' })
  }
  return sendJson(res, 200, { ok: true, files, db: DB.info() })
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 9) }

/* ---------------- AI 投入决策复核（GO / NO-GO） ---------------- */
async function handleAiJudge(req, res) {
  let body
  try { body = await readBody(req, 256 * 1024) } catch (e) { return sendJson(res, 400, { error: e.message }) }
  const prompt = String(body.prompt || '').trim()
  if (!prompt) return sendJson(res, 400, { error: 'prompt 不能为空' })
  const key = 'ai-go:' + String(body.projectId || 'misc').slice(0, 64)
  const run = async () => {
    const sess = pool.get(key)
    if (!sess.connected) await sess.open()
    const r = await sess.submit(prompt)
    pool.recordSession(key, r.sessionId, r.storedSessionId)
    return r
  }
  try {
    const r = await run()
    return sendJson(res, 200, { ok: true, text: r.text || '', usage: r.usage || null, sessionId: r.sessionId })
  } catch (e) {
    log('AI 复核首次失败，重建会话重试:', e && e.message)
    pool.drop(key)
    try {
      const r2 = await run()
      return sendJson(res, 200, { ok: true, text: r2.text || '', usage: r2.usage || null, sessionId: r2.sessionId, retried: true })
    } catch (e2) {
      return sendJson(res, 502, { error: 'AI 复核失败：' + ((e2 && e2.message) || e2) })
    }
  }
}


/* ---------------- Hermes 文件代理 ---------------- */
async function handleHermesFileBrowse(req, res, sp) {
  const url = process.env.HERMES_URL || 'http://127.0.0.1:9119'
  const cookie = await hermesCookieCached()
  const filePath = sp ? sp.get('path') : ''
  if (!filePath) return sendJson(res, 400, { error: 'path 参数必填' })
  const apiUrl = `${url}/api/files?path=${encodeURIComponent(filePath)}`
  const r = await fetchWithTimeout(apiUrl, { headers: { cookie } }, HERMES_TIMEOUT_MS)
  if (!r.ok) {
    if (r.status === 401) invalidateCookieCache()
    return sendJson(res, r.status, { error: `Hermes 文件浏览失败 HTTP ${r.status}` })
  }
  const data = await r.json()
  return sendJson(res, 200, { ok: true, ...data })
}

async function handleHermesFileDownload(req, res, sp) {
  const url = process.env.HERMES_URL || 'http://127.0.0.1:9119'
  const filePath = sp ? sp.get('path') : ''
  if (!filePath) return sendJson(res, 400, { error: 'path 参数必填' })
  const apiUrl = `${url}/api/files/download?path=${encodeURIComponent(filePath)}`
  let r = await fetchWithTimeout(apiUrl, { headers: { cookie: await hermesCookieCached() } }, 300000)
  if (r.status === 401) {
    // Hermes 会话 cookie 过期：作废缓存并用新 cookie 透明重试一次，
    // 避免用户首次点击下载就收到 401（浏览器表现为“无法从网站上提取文件”）
    invalidateCookieCache()
    r = await fetchWithTimeout(apiUrl, { headers: { cookie: await hermesCookieCached() } }, 300000)
  }
  if (!r.ok) {
    return sendJson(res, r.status, { error: `Hermes 文件下载失败 HTTP ${r.status}` })
  }
  const ct = r.headers.get('content-type') || 'application/octet-stream'
  const cd = r.headers.get('content-disposition') || ''
  const buf = Buffer.from(await r.arrayBuffer())
  res.writeHead(200, {
    'content-type': ct,
    'content-length': buf.length,
    'content-disposition': cd || `attachment; filename="${encodeURIComponent(path.basename(filePath))}"`,
    'cache-control': 'no-cache',
  })
  res.end(buf)
}

async function handleHermesFileList(req, res) {
  const url = process.env.HERMES_URL || 'http://127.0.0.1:9119'
  const cookie = await hermesCookieCached()
  const wsBase = '/opt/data/profiles/wordpresales/workspace'

  async function browseDir(dirPath) {
    const apiUrl = `${url}/api/files?path=${encodeURIComponent(dirPath)}`
    const r = await fetchWithTimeout(apiUrl, { headers: { cookie } }, HERMES_TIMEOUT_MS)
    if (!r.ok) return []
    const data = await r.json()
    const results = []
    for (const entry of (data.entries || [])) {
      if (entry.is_directory) {
        const subResults = await browseDir(entry.path)
        results.push(...subResults)
      } else {
        const ext = path.extname(entry.name).toLowerCase()
        if (['.pptx', '.ppt', '.docx', '.doc', '.xlsx', '.xls', '.pdf'].includes(ext)) {
          results.push({
            name: entry.name,
            path: entry.path,
            size: entry.size,
            ext: ext,
            mtime: entry.mtime,
            mtimeStr: entry.mtime ? new Date(entry.mtime * 1000).toISOString() : null,
          })
        }
      }
    }
    return results
  }

  try {
    const files = await browseDir(wsBase)
    files.sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
    return sendJson(res, 200, { ok: true, count: files.length, files })
  } catch (err) {
    log('扫描 Hermes workspace 文件失败:', err && err.message)
    return sendJson(res, 502, { error: '扫描文件失败: ' + (err && err.message) })
  }
}

/* ---------------- 健康检查 ---------------- */
async function handleHealth(req, res) {
  if (Date.now() - _healthCache.at < HEALTH_TTL_MS && _healthCache.data) {
    return sendJson(res, 200, { ..._healthCache.data, cached: true })
  }
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
    asyncTasks: taskStats(),
    memoryMB: Math.round(process.memoryUsage().rss / 1048576),
    node: process.version,
    db: _dbReady ? (() => { try { return DB.info() } catch (e) { return { error: e.message } } })() : { error: 'unavailable' },
  }
  try {
    const r = await fetchWithTimeout(out.hermesUrl + '/', { method: 'GET' }, HERMES_TIMEOUT_MS)
    out.hermesReachable = r.status
  } catch (e) { out.hermesReachable = 'unreachable: ' + (e && e.message) }
  if (WEKNORA_ENABLED) {
    try {
      const r = await fetchWithTimeout(`${WEKNORA_URL}/api/v1/knowledge-bases/${WEKNORA_KB_ID}`, { headers: { 'x-api-key': WEKNORA_API_KEY } }, WEKNORA_TIMEOUT_MS)
      out.weknoraReachable = r.status
    } catch (e) { out.weknoraReachable = 'unreachable: ' + (e && e.message) }
  }
  _healthCache = { at: Date.now(), data: out }
  sendJson(res, 200, out)
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = req.url || '/'
  try {
    if (url === '/api/chat' && req.method === 'POST') return void (await handleChat(req, res))
    if (url.startsWith('/api/chat/poll/') && req.method === 'GET') {
      return void (await handlePoll(req, res, decodeURIComponent(url.slice('/api/chat/poll/'.length).split('?')[0])))
    }
    if (url === '/api/chat/extract' && req.method === 'POST') return void (await handleExtract(req, res))
    if (url.startsWith('/api/sessions') && req.method === 'GET') return void (await handleSessions(req, res))
    if (url.startsWith('/api/session/attach') && req.method === 'POST') return void (await handleAttach(req, res))
    if (url.startsWith('/api/health')) return void (await handleHealth(req, res))
    if (url === '/api/ai/judge' && req.method === 'POST') return void (await handleAiJudge(req, res))

    /* 通用文件上传/下载 */
    if (url === '/api/files/upload' && req.method === 'POST') return void (await handleFileUpload(req, res))
    if ((url === '/api/files' || url.startsWith('/api/files?')) && req.method === 'GET') {
      const sp = new URL(url, 'http://localhost').searchParams
      return void (await handleFileList(req, res, sp))
    }
    if (url.startsWith('/api/files/download/') && req.method === 'GET') {
      return void (await handleFileDownload(req, res, decodeURIComponent(url.slice('/api/files/download/'.length).split('?')[0])))
    }
    if (url.startsWith('/api/files/') && req.method === 'DELETE') {
      return void (await handleFileDelete(req, res, decodeURIComponent(url.slice('/api/files/'.length).split('?')[0])))
    }

    /* 工作台业务数据（SQLite） */
    if (url.startsWith('/api/state')) {
      const p = url.split('?')[0]
      if (p === '/api/state' || p === '/api/state/') {
        if (req.method === 'GET') {
          const sp = new URL(url, 'http://localhost').searchParams
          return void (await handleStateList(req, res, sp))
        }
        return sendJson(res, 405, { error: 'method not allowed' })
      }
      if (p === '/api/state/import' && req.method === 'POST') return void (await handleStateImport(req, res))
      const key = decodeURIComponent(p.slice('/api/state/'.length))
      if (!key) return sendJson(res, 400, { error: '缺少集合名' })
      if (req.method === 'GET') return void (await handleStateGet(req, res, key))
      if (req.method === 'PUT') return void (await handleStatePut(req, res, key))
      if (req.method === 'DELETE') return void (await handleStateDelete(req, res, key))
      return sendJson(res, 405, { error: 'method not allowed' })
    }

    /* WeKnora 代理 */
    if (url.startsWith('/api/weknora/doc-category')) {
      if (req.method === 'GET') return void (await handleCatMapGet(req, res))
      if (req.method === 'PUT') return void (await handleCatMapPut(req, res))
      return sendJson(res, 405, { error: 'method not allowed' })
    }
    if (req.method === 'GET' && url.startsWith('/api/weknora/')) {
      const sp = new URL(url, 'http://localhost').searchParams
      const kb = await pickKb(sp)
      const p = url.split('?')[0]
      if (p === '/api/weknora/kbs') return proxyToWeKnora(req, res, '/knowledge-bases', '')
      if (p === '/api/weknora/knowledge-base') return proxyToWeKnora(req, res, `/knowledge-bases/${kb}`, '')
      if (p.startsWith('/api/weknora/download/')) {
        const id = decodeURIComponent(p.slice('/api/weknora/download/'.length))
        if (!id) return sendJson(res, 400, { error: '缺少文档 ID' })
        const name = String(sp.get('name') || id).slice(0, 120)
        return proxyToWeKnora(req, res, `/knowledge/${id}/download`, '',
          { disposition: `attachment; filename="${encodeURIComponent(name)}"` })
      }
      if (p === '/api/weknora/knowledge') {
        const search = url.replace(/^\/api\/weknora\/knowledge/, '')
        return proxyToWeKnora(req, res, `/knowledge-bases/${kb}/knowledge`, search)
      }
      if (p.startsWith('/api/weknora/knowledge/')) {
        const id = decodeURIComponent(p.slice('/api/weknora/knowledge/'.length))
        if (!id) return sendJson(res, 400, { error: '缺少文档 ID' })
        return proxyToWeKnora(req, res, `/knowledge/${id}`, '')
      }
    }
    if (url.startsWith('/api/weknora/') && (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE')) {
      return sendJson(res, 403, { error: '工作台侧已向量化知识库已改为只读（查询与下载），如需上传或清理请到 WeKnora 操作' })
    }

    /* Hermes 文件代理 */
    if (req.method === 'GET' && url.startsWith('/api/hermes/files/download')) {
      const sp = new URL(url, 'http://localhost').searchParams
      return void (await handleHermesFileDownload(req, res, sp))
    }
    if (req.method === 'GET' && url.startsWith('/api/hermes/files/list')) {
      return void (await handleHermesFileList(req, res))
    }
    if (req.method === 'GET' && url.startsWith('/api/hermes/files')) {
      const sp = new URL(url, 'http://localhost').searchParams
      return void (await handleHermesFileBrowse(req, res, sp))
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
  log(`超时: turn=${process.env.HERMES_TURN_TIMEOUT_MS || 300000}ms idle=${process.env.HERMES_IDLE_TIMEOUT_MS || 150000}ms`)
  if (!process.env.HERMES_PASS) log('警告：未设置 HERMES_PASS，对话将无法鉴权')
  log(`WeKnora: ${WEKNORA_ENABLED ? '已启用 KB=' + WEKNORA_KB_ID : '未配置'}`)
  log('异步任务层已启用：SSE 断开后可轮询 /api/chat/poll/:taskId 获取结果')
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { log('收到', sig, '，退出'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000) })
}
process.on('unhandledRejection', (e) => log('unhandledRejection:', e && e.message || e))
