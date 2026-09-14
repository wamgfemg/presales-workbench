'use strict'
/* 售前工作台 · 鉴权与 RBAC（零依赖：node:crypto + JSON 文件存储 + 签名 Cookie 会话）
 * 角色：admin（全部 + 用户管理）/ user（按模块 view/edit 授权）。
 * 读接口对所有登录用户开放（团队共享数据），写接口按模块 edit 权限强制；用户管理仅 admin。
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const COOKIE = 'pw_session'
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 12 * 3600 * 1000)

const MODULES = [
  { key: 'dash', label: '工作台首页' },
  { key: 'projects', label: '项目管理' },
  { key: 'qa', label: '智能问答' },
  { key: 'kb', label: '向量知识库' },
  { key: 'pdocs', label: '项目知识库' },
  { key: 'docs', label: '方案制作中心' },
  { key: 'c139', label: 'C139 赢单评估' },
  { key: 'tools', label: '标书检查清单' },
  { key: 'bidagent', label: '投标智能体' },
  { key: 'chain', label: '决策链' },
  { key: 'contracts', label: '合同管理' },
  { key: 'quotations', label: '报价管理' },
  { key: 'compintel', label: '竞争情报' },
  { key: 'requirements', label: '需求管理' },
  { key: 'market', label: '市场情报' },
  { key: 'marketdaily', label: '厂商动态' },
  { key: 'aidaily', label: 'AI应用日报' },
  { key: 'scenario', label: '解决方案创新场景' },
  { key: 'sales', label: '销售培训' },
  { key: 'toolbox', label: '售前工具箱' },
  { key: 'capability', label: '能力提升' },
]
const MODULE_KEYS = MODULES.map(m => m.key)
const LABEL = k => (MODULES.find(m => m.key === k) || {}).label || k
// 业务集合 key → 所属模块（写权限判定用）
const STATE_KEY_MODULE = {
  projects: 'projects', tasks: 'projects', followups: 'projects',
  requirements: 'requirements', stakeholders: 'chain', competitors: 'market', salesTraining: 'sales', toolbox: 'toolbox', capability: 'capability',
  contracts: 'contracts', quotations: 'quotations', compintel: 'compintel',
  kb: 'kb', kbTree: 'kb', pdocs: 'pdocs', docs: 'docs', checklists: 'tools',
}
// 个人/低危写入，任何登录用户可写
const OPEN_WRITE_KEYS = new Set(['ui', 'bidAgentConvs'])

let DATA_DIR, LOG, USERS_FILE, SECRET

function init(opts) {
  DATA_DIR = opts.DATA_DIR; LOG = opts.log || function () {}
  USERS_FILE = path.join(DATA_DIR, 'users.json')
  SECRET = loadSecret()
}
function loadSecret() {
  if (process.env.AUTH_SECRET) return String(process.env.AUTH_SECRET)
  const f = path.join(DATA_DIR, '.authsecret')
  try { if (fs.existsSync(f)) { const s = fs.readFileSync(f, 'utf8').trim(); if (s) return s } } catch (_) {}
  const s = crypto.randomBytes(32).toString('hex')
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(f, s, { mode: 0o600 }) } catch (e) { LOG('写 .authsecret 失败：' + e.message) }
  return s
}

function loadUsers() { try { const a = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); return Array.isArray(a) ? a : [] } catch (_) { return [] } }
function saveUsers(list) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); const tmp = USERS_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(list)); fs.renameSync(tmp, USERS_FILE) }
  catch (e) { LOG('保存用户失败：' + e.message) }
}
function newSalt() { return crypto.randomBytes(16).toString('hex') }
function hashPw(pw, salt) { return crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 32).toString('hex') }
function verifyPw(pw, salt, hash) { try { return crypto.timingSafeEqual(Buffer.from(hashPw(pw, salt), 'hex'), Buffer.from(hash, 'hex')) } catch (_) { return false } }

function ensureBootstrap() {
  const users = loadUsers()
  if (users.length) return
  const uname = process.env.ADMIN_USER || 'admin'
  const initPw = process.env.ADMIN_INIT_PASSWORD || 'Admin@12345'
  const salt = newSalt()
  users.push({ id: 'u_admin', username: uname, salt, hash: hashPw(initPw, salt), role: 'admin', perms: {}, active: true, ver: 1, createdAt: Date.now(), mustChange: !process.env.ADMIN_INIT_PASSWORD })
  saveUsers(users)
  LOG('已创建初始管理员账号：' + uname + '（请尽快在「修改密码」中更换初始密码）')
}

function publicUser(u) { return { id: u.id, username: u.username, role: u.role, perms: u.perms || {}, active: u.active !== false, mustChange: !!u.mustChange, createdAt: u.createdAt } }
function normalizePerms(perms) { const out = {}; if (perms && typeof perms === 'object') { for (const k of MODULE_KEYS) { const v = perms[k]; if (v === 'view' || v === 'edit') out[k] = v } } return out }

/* ---- 会话（签名 Cookie，无状态，重启不掉线） ---- */
function sign(payload) { const b = Buffer.from(JSON.stringify(payload)).toString('base64url'); const mac = crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); return b + '.' + mac }
function unsign(tok) {
  if (!tok || tok.indexOf('.') < 0) return null
  const i = tok.indexOf('.'); const b = tok.slice(0, i); const mac = tok.slice(i + 1)
  const exp = crypto.createHmac('sha256', SECRET).update(b).digest('base64url')
  let p
  try { if (mac.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(exp))) return null; p = JSON.parse(Buffer.from(b, 'base64url').toString('utf8')) } catch (_) { return null }
  return p
}
function parseCookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(kv => { const i = kv.indexOf('='); if (i > 0) o[kv.slice(0, i).trim()] = decodeURIComponent(kv.slice(i + 1).trim()) }); return o }
function authenticate(req) {
  const c = parseCookies(req)[COOKIE]; if (!c) return null
  const p = unsign(c); if (!p || !p.exp || p.exp < Date.now()) return null
  const u = loadUsers().find(x => x.id === p.uid); if (!u || u.active === false) return null
  if ((u.ver || 1) !== p.ver) return null
  return u
}
function setSession(res, user) { const tok = sign({ uid: user.id, ver: user.ver || 1, exp: Date.now() + SESSION_TTL_MS }); res.setHeader('set-cookie', COOKIE + '=' + encodeURIComponent(tok) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000)) }
function clearSession(res) { res.setHeader('set-cookie', COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0') }

/* ---- 工具 ---- */
function sendJson(res, code, obj) { const body = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length }); res.end(body) }
function readJson(req) { return new Promise((resolve, reject) => { let n = 0; const ch = []; req.on('data', c => { n += c.length; if (n > 2e6) { reject(new Error('请求体过大')); req.destroy(); return } ch.push(c) }); req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(ch).toString('utf8') || '{}')) } catch (e) { reject(e) } }); req.on('error', reject) }) }

/* ---- 授权（写接口按模块 edit；读接口对所有登录用户开放；admin 全通） ---- */
function authorize(user, p, method) {
  if (user.role === 'admin') return { ok: true }
  if (method === 'GET' || method === 'HEAD') return { ok: true }
  const perms = user.perms || {}
  const canEdit = m => perms[m] === 'edit'
  if (p === '/api/state/import') return canEdit('projects') ? { ok: true } : { ok: false, error: '需要「项目管理」编辑权限' }
  if (p.startsWith('/api/state/')) {
    const key = decodeURIComponent(p.slice('/api/state/'.length))
    if (OPEN_WRITE_KEYS.has(key)) return { ok: true }
    const mod = STATE_KEY_MODULE[key]
    if (!mod) return { ok: false, error: '该操作需要管理员权限' }
    return canEdit(mod) ? { ok: true } : { ok: false, error: '对「' + LABEL(mod) + '」只有只读权限，无法保存' }
  }
  if (p === '/api/files/upload' || p.startsWith('/api/files/')) return (canEdit('pdocs') || canEdit('contracts') || canEdit('toolbox') || canEdit('capability')) ? { ok: true } : { ok: false, error: '需要「项目知识库/合同管理/售前工具箱/能力提升」编辑权限' }
  if (p === '/api/weknora/doc-category') return canEdit('kb') ? { ok: true } : { ok: false, error: '需要「向量知识库」编辑权限' }
  if (p.startsWith('/api/market')) return canEdit('market') ? { ok: true } : { ok: false, error: '需要「市场情报」编辑权限' }
  if (p.startsWith('/api/aidaily')) return canEdit('aidaily') ? { ok: true } : { ok: false, error: '需要「AI应用日报」编辑权限' }
  if (p.startsWith('/api/scenario')) return canEdit('scenario') ? { ok: true } : { ok: false, error: '需要「解决方案创新场景」编辑权限' }
  return { ok: true } // chat / qa / reset / attach 等：任何登录用户可用
}

/* ---- 端点 ---- */
async function handleLogin(req, res) {
  let b; try { b = await readJson(req) } catch (_) { return sendJson(res, 400, { error: '请求格式错误' }) }
  const uname = String(b.username || '').trim(); const pw = String(b.password || '')
  const user = loadUsers().find(x => x.username === uname)
  if (!user || user.active === false || !verifyPw(pw, user.salt, user.hash)) return sendJson(res, 401, { error: '用户名或密码错误' })
  setSession(res, user)
  sendJson(res, 200, { ok: true, user: publicUser(user) })
}
function handleLogout(req, res) { clearSession(res); sendJson(res, 200, { ok: true }) }
function handleMe(req, res, user) { sendJson(res, 200, { ok: true, user: publicUser(user), modules: MODULES }) }

function activeAdminCount(users) { return users.filter(u => u.role === 'admin' && u.active !== false).length }

async function handleUsers(req, res, admin, p) {
  const method = req.method
  if (method === 'GET' && p === '/api/users') return sendJson(res, 200, { ok: true, users: loadUsers().map(publicUser), modules: MODULES })
  if (method === 'POST' && p === '/api/users') {
    let b; try { b = await readJson(req) } catch (_) { return sendJson(res, 400, { error: '格式错误' }) }
    const uname = String(b.username || '').trim(); const role = b.role === 'admin' ? 'admin' : 'user'; const pw = String(b.password || '')
    if (!/^[A-Za-z0-9_.@\u4e00-\u9fa5-]{2,32}$/.test(uname)) return sendJson(res, 400, { error: '用户名需 2-32 位（字母/数字/_ . @ -/中文）' })
    if (pw.length < 6) return sendJson(res, 400, { error: '密码至少 6 位' })
    const users = loadUsers()
    if (users.some(u => u.username === uname)) return sendJson(res, 400, { error: '用户名已存在' })
    const salt = newSalt(); const id = 'u' + crypto.randomBytes(6).toString('hex')
    const nu = { id, username: uname, salt, hash: hashPw(pw, salt), role, perms: normalizePerms(b.perms), active: true, ver: 1, createdAt: Date.now(), mustChange: false }
    users.push(nu); saveUsers(users)
    return sendJson(res, 200, { ok: true, user: publicUser(nu) })
  }
  const id = decodeURIComponent(p.slice('/api/users/'.length))
  const users = loadUsers(); const idx = users.findIndex(u => u.id === id)
  if (idx < 0) return sendJson(res, 404, { error: '用户不存在' })
  const u = users[idx]
  if (method === 'PUT') {
    let b; try { b = await readJson(req) } catch (_) { return sendJson(res, 400, { error: '格式错误' }) }
    const wasAdmin = u.role === 'admin' && u.active !== false
    if (b.role) u.role = b.role === 'admin' ? 'admin' : 'user'
    if (b.perms) u.perms = normalizePerms(b.perms)
    if (b.active !== undefined) u.active = !!b.active
    if (b.username && b.username !== u.username) { if (!/^[A-Za-z0-9_.@\u4e00-\u9fa5-]{2,32}$/.test(b.username)) return sendJson(res, 400, { error: '用户名不合法' }); if (users.some(x => x.username === b.username)) return sendJson(res, 400, { error: '用户名已存在' }); u.username = b.username }
    if (b.password) { if (String(b.password).length < 6) return sendJson(res, 400, { error: '密码至少 6 位' }); u.salt = newSalt(); u.hash = hashPw(String(b.password), u.salt); u.mustChange = false }
    // 防止把最后一个可用管理员降级/禁用
    if (wasAdmin && activeAdminCount(users) === 0) { u.role = 'admin'; u.active = true; return sendJson(res, 400, { error: '至少保留一个可用管理员' }) }
    u.ver = (u.ver || 1) + 1
    saveUsers(users); return sendJson(res, 200, { ok: true, user: publicUser(u) })
  }
  if (method === 'DELETE') {
    if (u.id === admin.id) return sendJson(res, 400, { error: '不能删除自己' })
    if (u.role === 'admin' && u.active !== false && activeAdminCount(users) <= 1) return sendJson(res, 400, { error: '至少保留一个管理员' })
    users.splice(idx, 1); saveUsers(users); return sendJson(res, 200, { ok: true })
  }
  return sendJson(res, 405, { error: 'method not allowed' })
}

async function handleChangePassword(req, res, user) {
  let b; try { b = await readJson(req) } catch (_) { return sendJson(res, 400, { error: '格式错误' }) }
  const oldp = String(b.old || ''), newp = String(b.new || '')
  if (newp.length < 6) return sendJson(res, 400, { error: '新密码至少 6 位' })
  const users = loadUsers(); const u = users.find(x => x.id === user.id); if (!u) return sendJson(res, 404, { error: '用户不存在' })
  if (!verifyPw(oldp, u.salt, u.hash)) return sendJson(res, 400, { error: '原密码不正确' })
  u.salt = newSalt(); u.hash = hashPw(newp, u.salt); u.mustChange = false; u.ver = (u.ver || 1) + 1
  saveUsers(users); setSession(res, u)
  sendJson(res, 200, { ok: true })
}

module.exports = { init, ensureBootstrap, authenticate, authorize, handleLogin, handleLogout, handleMe, handleUsers, handleChangePassword, MODULES }
