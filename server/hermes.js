'use strict'
/**
 * Hermes Agent 无头对话客户端（零第三方依赖，依赖 Node >= 22 的全局 fetch / WebSocket）
 *
 * 已实测确认的协议（49.233.179.30:9119）：
 *   1. POST /auth/password-login {username,password,provider:"basic"}  -> Set-Cookie
 *   2. POST /api/auth/ws-ticket  (带 cookie)                           -> {ticket}  TTL 30s
 *   3. ws://host:9119/api/ws?ticket=xxx                                 换行分隔 JSON-RPC
 *   4. session.create {profile,cols,source}                             -> result.session_id
 *   5. prompt.submit  {session_id,text,profile}                         -> 流式事件
 *   事件：message.start / thinking.delta / reasoning.delta / reasoning.available
 *        / message.delta(payload.text) / session.usage / message.complete(payload.text,status,usage)
 *   工具调用类事件（tool.*）按状态提示透传。
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
    this.sessionId = null
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
  open() {
    if (this.opening) return this.opening
    this.opening = this._open().finally(() => { this.opening = null })
    return this.opening
  }

  async _open() {
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

    const res = await this._rpc('session.create', {
      profile: this.cfg.profile, cols: 120, source: 'presales-workbench',
    }, 60000)
    this.sessionId = res && res.session_id
    this.model = (res && res.info && res.info.model) || null
    if (!this.sessionId) throw new Error('session.create 未返回 session_id')
    this.lastUsed = Date.now()
    return this.sessionId
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
        turn.emit({ type: 'status', text: '专家正在思考…' })
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
    return result
  }
}

/* ---------------- 会话池：按 key（前端任务 id）复用，控制内存 ---------------- */
class HermesPool {
  constructor(opts = {}) {
    this.opts = opts
    this.max = Number(process.env.HERMES_MAX_SESSIONS || 8)
    this.ttlMs = Number(process.env.HERMES_SESSION_TTL_MS || 45 * 60 * 1000)
    this.map = new Map()
    this.sweeper = setInterval(() => this.sweep(), 60000)
    if (this.sweeper.unref) this.sweeper.unref()
  }

  get(key) {
    let s = this.map.get(key)
    if (!s) {
      this.evictIfNeeded()
      s = new HermesSession(this.opts)
      this.map.set(key, s)
    }
    s.lastUsed = Date.now()
    return s
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
  }

  stats() {
    return { sessions: this.map.size, max: this.max,
      keys: [...this.map.keys()].map((k) => String(k).slice(0, 12)) }
  }
}

module.exports = { HermesSession, HermesPool, DEFAULTS }
