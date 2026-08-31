'use strict'
/**
 * Hermes Agent 无头对话客户端（零第三方依赖，依赖 Node >= 22 的全局 fetch / WebSocket）
 *
 * 已实测确认的协议（49.233.179.30:9119）：
 *   1. POST /auth/password-login {username,password,provider:"basic"}  -> Set-Cookie
 *   2. POST /api/auth/ws-ticket  (带 cookie)                           -> {ticket}  TTL 30s
 *   3. ws://host:9119/api/ws?ticket=xxx                                 换行分隔 JSON-RPC
 *   4. session.create {profile,cols,source}                             -> result.{session_id, stored_session_id}
 *   5. prompt.submit  {session_id,text,profile}                         -> 流式事件
 *   事件：message.start / thinking.delta / reasoning.delta / reasoning.available
 *        / message.delta(payload.text) / session.usage / message.complete(payload.text,status,usage)
 *   工具调用类事件（tool.*）按状态提示透传。
 *
 * 关键约定：
 *   - session_id: 短码，用于 prompt.submit。
 *   - stored_session_id: 长码，对应 /api/sessions 列表中的 id，用于前端对齐 Hermes 历史对话。
 */

const DEFAULTS = {
  url: process.env.HERMES_URL || 'http://127.0.0.1:9119',
  user: process.env.HERMES_USER || 'admin',
  pass: process.env.HERMES_PASS || '',
  profile: process.env.HERMES_PROFILE || 'wordpresales',
  turnTimeoutMs: Number(process.env.HERMES_TURN_TIMEOUT_MS || 300000), // 单回合最长 5 分钟
  idleTimeoutMs: Number(process.env.HERMES_IDLE_TIMEOUT_MS || 150000), // 回合内无事件 2.5 分钟即判失败
}

const INTERNAL_TYPES = new Set([
  'gateway.ready', 'session.info', 'thinking.delta', 'reasoning.delta',
  'reasoning.available', 'session.usage', 'message.start',
])

class HermesSession {
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...opts }
    this.ws = null
    this.sessionId = null        // 短码，用于 submit
    this.storedSessionId = null   // 长码，与 /api/sessions 对齐
    this.model = null
    this.buf = ''
    this.nextId = 1
    this.pending = new Map()
    this.turn = null
    this.lastUsed = Date.now()
    this.opening = null
  }

  get connected() { return !!(this.ws && this.sessionId && this.ws.readyState === 1) }

  /* ---------------- HTTP 鉴权 ---------------- */
  async _cookie() {
    const r = await fetch(`${this.cfg.url}/auth/password-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.cfg.user, password: this.cfg.pass, provider: 'basic' }),
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

  async _ticket(cookie) {
    // 注意：必须用 POST，GET 会 404
    const r = await fetch(`${this.cfg.url}/api/auth/ws-ticket`, { method: 'POST', headers: { cookie } })
    if (!r.ok) throw new Error(`获取 ws-ticket 失败 HTTP ${r.status}`)
    const d = await r.json()
    if (!d || !d.ticket) throw new Error('ws-ticket 响应缺少 ticket')
    return d.ticket
  }

  /* ---------------- 建立会话 ---------------- */
  open(preferredSessionId) {
    if (this.opening) return this.opening
    this.opening = this._open(preferredSessionId).finally(() => { this.opening = null })
    return this.opening
  }

  async _open(preferredSessionId) {
    this.close(true)
    const cookie = await this._cookie()
    const ticket = await this._ticket(cookie) // TTL 30s，拿到后立刻连
    const wsUrl = `${this.cfg.url.replace(/^http/, 'ws')}/api/ws?ticket=${encodeURIComponent(ticket)}`

    await new Promise((resolve, reject) => {
      let settled = false
      const ws = new WebSocket(wsUrl)
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try { ws.close() } catch (_) {}
        reject(new Error('WebSocket 连接超时'))
      }, 25000)
      ws.onopen = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.ws = ws
        resolve()
      }
      ws.onerror = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error('WebSocket 连接失败'))
      }
      ws.onmessage = (ev) => {
        const d = ev.data
        if (typeof d === 'string') { this._onData(d); return }
        // 兜底：极少数情况下服务端可能发二进制帧
        if (d && typeof d.arrayBuffer === 'function') {
          d.arrayBuffer().then((b) => this._onData(Buffer.from(b).toString('utf8'))).catch(() => {})
          return
        }
        if (d instanceof ArrayBuffer) { this._onData(Buffer.from(d).toString('utf8')); return }
        this._onData(String(d || ''))
      }
      ws.onclose = () => {
        if (this.ws === ws) { this.ws = null; this.sessionId = null }
        for (const [, p] of this.pending) p.reject(new Error('WebSocket 已断开'))
        this.pending.clear()
        if (this.turn) this._failTurn(new Error('WebSocket 在回合中断开'))
      }
    })

    // 如果调用方指定了短码 sessionId，则直接复用该会话（Hermes 支持跨 WS 复用）
    if (preferredSessionId) {
      this.sessionId = preferredSessionId
      this.lastUsed = Date.now()
      // 不单独验证，交给后续 submit 失败重试机制兜底
      return { sessionId: this.sessionId, storedSessionId: this.storedSessionId }
    }

    const res = await this._rpc('session.create', {
      profile: this.cfg.profile, cols: 120, source: 'presales-workbench',
    }, 60000)
    this.sessionId = res && res.session_id
    this.storedSessionId = (res && res.stored_session_id) || null
    this.model = (res && res.info && res.info.model) || null
    if (!this.sessionId) throw new Error('session.create 未返回 session_id')
    this.lastUsed = Date.now()
    return { sessionId: this.sessionId, storedSessionId: this.storedSessionId }
  }

  close(silent) {
    if (this.ws) { try { this.ws.close() } catch (_) {} }
    this.ws = null
    this.sessionId = null
    this.buf = ''
    if (!silent && this.turn) this._failTurn(new Error('会话已关闭'))
  }

  /* ---------------- 收发 ---------------- */
  _send(obj) {
    if (!this.ws || this.ws.readyState !== 1) throw new Error('WebSocket 未连接')
    // 协议要求：换行分隔的 JSON，每条必须以 \n 结尾
    this.ws.send(JSON.stringify(obj) + '\n')
  }

  _rpc(method, params, timeoutMs = 30000) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} 响应超时`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); this.pending.delete(id); resolve(v) },
        reject: (e) => { clearTimeout(timer); this.pending.delete(id); reject(e) },
      })
      try { this._send({ jsonrpc: '2.0', id, method, params }) }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e) }
    })
  }

  /**
   * 解析收到的数据。
   * 实测：Hermes 每个 WS 帧就是一条完整 JSON，且**结尾不带换行**（发送方向才必须带 \n）。
   * 因此不能无条件把最后一段当"不完整片段"缓存起来，否则消息永远不会被解析。
   * 策略：按 \n 切分逐段尝试 JSON.parse；解析成功即消费，仅当最后一段解析失败时才留作待续片段。
   */
  _onData(chunk) {
    this.buf += chunk
    const parts = this.buf.split('\n')
    this.buf = ''
    for (let i = 0; i < parts.length; i++) {
      const s = parts[i].trim()
      if (!s) continue
      let m = null
      try { m = JSON.parse(s) } catch (_) { m = null }
      if (m === null) {
        if (i === parts.length - 1) this.buf = parts[i] // 可能被 TCP 截断，等下一帧续上
        continue
      }
      this._dispatch(m)
    }
    if (this.buf.length > 4 * 1024 * 1024) this.buf = '' // 防御：异常数据不无限增长
  }

  _dispatch(m) {
    if (m.id != null && this.pending.has(m.id)) {
      const p = this.pending.get(m.id)
      if (m.error) p.reject(new Error(m.error.message || JSON.stringify(m.error)))
      else p.resolve(m.result)
      return
    }
    if (m.method === 'event' && m.params) this._event(m.params)
  }

  _event(p) {
    const t = p.type || ''
    const payload = p.payload || {}
    const turn = this.turn
    if (!turn) return
    turn.lastEvent = Date.now()

    if (t === 'message.delta') {
      const text = payload.text || ''
      if (text) { turn.full += text; turn.emit({ type: 'delta', text }) }
      return
    }
    if (t === 'message.complete') {
      const finalText = payload.text || turn.full
      turn.full = finalText
      this._finishTurn({
        text: finalText,
        status: payload.status || 'complete',
        usage: payload.usage || null,
      })
      return
    }
    if (t === 'thinking.delta' || t === 'reasoning.delta') {
      if (!turn.thinkingNotified) {
        turn.thinkingNotified = true
        turn.lastSlowHint = 0
        turn.emit({ type: 'status', text: '专家正在思考…' })
      } else {
        // Hermes 会在 provider 慢/过载时周期性发 thinking.delta 告警（如"30s with no output yet"）。
        // 这类信号对前端很有用，转发为用户友好的"模型响应较慢"提示（节流 20s，避免刷屏）。
        var pt = String(payload.text || '').toLowerCase()
        if (/slow|overload|no output|waiting|timeout|繁忙|无输出|响应慢|重试|reconnect/.test(pt)) {
          var now = Date.now()
          if (!turn.lastSlowHint || now - turn.lastSlowHint > 20000) {
            turn.lastSlowHint = now
            turn.emit({ type: 'status', text: '模型响应较慢：provider 可能繁忙或过载，请稍候，系统会在恢复后继续…' })
          }
        }
      }
      return
    }
    if (t.startsWith('tool.') || t.includes('tool_call') || t === 'tool') {
      const name = payload.name || payload.tool || p.name || '工具'
      turn.emit({ type: 'status', text: `调用工具：${name}` })
      return
    }
    if (t === 'session.usage') {
      turn.usage = payload.usage || null
      return
    }
    if (t === 'error' || t === 'session.error') {
      this._failTurn(new Error(payload.message || payload.text || 'Hermes 返回错误'))
      return
    }
    if (!INTERNAL_TYPES.has(t)) {
      // 未知事件：不打断，仅在有文本时透出
      if (payload.text && typeof payload.text === 'string' && t.endsWith('.delta')) {
        turn.full += payload.text
        turn.emit({ type: 'delta', text: payload.text })
      }
    }
  }

  _clearTurn() {
    if (!this.turn) return null
    const t = this.turn
    this.turn = null
    clearTimeout(t.hardTimer)
    clearInterval(t.idleTimer)
    return t
  }

  _finishTurn(result) {
    const t = this._clearTurn()
    if (t) t.resolve({ ...result, usage: result.usage || t.usage || null })
  }

  _failTurn(err) {
    const t = this._clearTurn()
    if (t) t.reject(err)
  }

  /* ---------------- 提交一轮对话 ---------------- */
  async submit(text, onEvent = () => {}) {
    if (!this.connected) await this.open()
    this.lastUsed = Date.now()
    if (this.turn) throw new Error('该会话已有对话进行中，请稍候')

    const result = await new Promise((resolve, reject) => {
      const turn = {
        full: '', usage: null, thinkingNotified: false,
        lastEvent: Date.now(), emit: onEvent, resolve, reject,
      }
      turn.hardTimer = setTimeout(
        () => this._failTurn(new Error('Hermes 回合超时（超过上限仍未结束）')),
        this.cfg.turnTimeoutMs,
      )
      turn.idleTimer = setInterval(() => {
        if (Date.now() - turn.lastEvent > this.cfg.idleTimeoutMs) {
          this._failTurn(new Error('Hermes 长时间无响应（回合空闲超时）'))
        }
      }, 5000)
      this.turn = turn

      this._rpc('prompt.submit', {
        session_id: this.sessionId, text, profile: this.cfg.profile,
      }, 60000).catch((e) => this._failTurn(e))
    })

    this.lastUsed = Date.now()
    return {
      ...result,
      sessionId: this.sessionId,
      storedSessionId: this.storedSessionId,
    }
  }
}

/* ---------------- 会话池：按 key（前端任务 id）复用，控制内存，持久化映射 ---------------- */
class HermesPool {
  constructor(opts = {}) {
    this.opts = opts
    this.max = Number(process.env.HERMES_MAX_SESSIONS || 8)
    this.ttlMs = Number(process.env.HERMES_SESSION_TTL_MS || 45 * 60 * 1000)
    this.map = new Map()
    this.sessionMap = new Map() // shortId -> { key, longId, createdAt, lastUsed }
    this.dataDir = process.env.DATA_DIR || '/opt/presales-workbench/data'
    this._load()
    this.sweeper = setInterval(() => this.sweep(), 60000)
    if (this.sweeper.unref) this.sweeper.unref()
  }

  _mapPath() { return require('node:path').join(this.dataDir, 'session-map.json') }

  _load() {
    try {
      const fs = require('node:fs')
      const p = this._mapPath()
      if (!fs.existsSync(p)) return
      const raw = fs.readFileSync(p, 'utf8')
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        for (const it of arr) {
          if (it && it.shortId) this.sessionMap.set(it.shortId, it)
        }
      }
    } catch (e) {
      console.error('加载 session-map 失败:', e && e.message)
    }
  }

  _save() {
    try {
      const fs = require('node:fs')
      const p = this._mapPath()
      fs.mkdirSync(require('node:path').dirname(p), { recursive: true })
      fs.writeFileSync(p, JSON.stringify([...this.sessionMap.values()], null, 2), 'utf8')
    } catch (e) {
      console.error('保存 session-map 失败:', e && e.message)
    }
  }

  get(key, preferredSessionId) {
    let s = this.map.get(key)
    // 若调用方没指定 sessionId，但本地 sessionMap 已有该 key 的绑定，则自动恢复旧 session
    if (!preferredSessionId) {
      let latest = null
      for (const it of this.sessionMap.values()) {
        if (it.key === key && (!latest || it.lastUsed > latest.lastUsed)) latest = it
      }
      if (latest) preferredSessionId = latest.shortId
    }
    const needCreate = !s || (preferredSessionId && s.sessionId !== preferredSessionId)
    if (needCreate) {
      // 如果 key 已经绑定别的 session，先 drop 掉
      if (s) this.drop(key)
      this.evictIfNeeded()
      s = new HermesSession(this.opts)
      if (preferredSessionId) s.sessionId = preferredSessionId
      this.map.set(key, s)
    }
    s.lastUsed = Date.now()
    return s
  }

  // 主动把 key 绑定到指定的 sessionId（短码）
  attach(key, shortId, longId) {
    this.sessionMap.set(shortId, {
      shortId, longId: longId || null, key,
      createdAt: Date.now(), lastUsed: Date.now(),
    })
    this._save()
  }

  // 根据 longId 找 shortId
  findByLongId(longId) {
    if (!longId) return null
    for (const it of this.sessionMap.values()) {
      if (it.longId === longId) return it
    }
    return null
  }

  recordSession(key, shortId, longId) {
    if (!shortId) return
    // 清理该 key 的旧映射，保证一个 key 只对应一个 session
    for (const [sid, it] of this.sessionMap) {
      if (it.key === key && sid !== shortId) this.sessionMap.delete(sid)
    }
    this.sessionMap.set(shortId, {
      shortId, longId: longId || null, key,
      createdAt: (this.sessionMap.get(shortId) || {}).createdAt || Date.now(),
      lastUsed: Date.now(),
    })
    this._save()
  }

  drop(key) {
    const s = this.map.get(key)
    if (s) { s.close(true); this.map.delete(key) }
  }

  evictIfNeeded() {
    while (this.map.size >= this.max) {
      let oldK = null, oldT = Infinity
      for (const [k, v] of this.map) {
        if (v.turn) continue           // 正在对话的不淘汰
        if (v.lastUsed < oldT) { oldT = v.lastUsed; oldK = k }
      }
      if (!oldK) break
      this.drop(oldK)
    }
  }

  sweep() {
    const now = Date.now()
    for (const [k, v] of [...this.map]) {
      if (!v.turn && now - v.lastUsed > this.ttlMs) this.drop(k)
    }
    this._save()
  }

  stats() {
    return {
      sessions: this.map.size, max: this.max,
      keys: [...this.map.keys()].map((k) => String(k).slice(0, 12)),
      map: [...this.sessionMap.values()].map((it) => ({ shortId: it.shortId, longId: it.longId, key: String(it.key).slice(0, 12), lastUsed: it.lastUsed })),
    }
  }

  listMap() {
    return [...this.sessionMap.values()]
  }
}

module.exports = { HermesSession, HermesPool, DEFAULTS }
