'use strict'
/* 市场情报：混合来源（RSS 自动抓 + 手动 URL/原文），OpenRouter 整理竞品对比表/行业简报/要点，
 * 每日 08:00 定时抓取 + 生成当日动态摘要，仅存清洗后正文与 AI 结果，保留最近 90 天。零第三方依赖。 */
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const https = require('node:https')
const crypto = require('node:crypto')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
const RETENTION_DAYS = Number(process.env.MARKET_RETENTION_DAYS || 90)
const MAX_ITEMS = Number(process.env.MARKET_MAX_ITEMS || 1200)
const OR_URL = (process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
const OR_KEY = process.env.OPENROUTER_API_KEY || ''
const OR_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat'

let DATA_DIR, LOG, FILE, db = null

const DEFAULT_SOURCES = [
  { name: 'InfoQ 中文', url: 'https://www.infoq.cn/feed' },
  { name: '少数派', url: 'https://sspai.com/feed' },
  { name: '钛媒体', url: 'https://www.tmtpost.com/rss.xml' },
  { name: '爱范儿', url: 'https://www.ifanr.com/feed' },
]

function init(opts) {
  DATA_DIR = opts.DATA_DIR; LOG = opts.log || function () {}
  FILE = path.join(DATA_DIR, 'market.json')
  load()
}
function load() {
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch (_) { db = null }
  if (!db || !Array.isArray(db.items)) {
    db = { sources: DEFAULT_SOURCES.map((s, i) => ({ id: 's' + (i + 1), name: s.name, url: s.url, active: true })), items: [], briefs: [], lastRun: 0 }
    save()
  }
}
function save() { try { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, FILE) } catch (e) { LOG('保存 market 失败：' + e.message) } }
function prune() {
  const cutoff = Date.now() - RETENTION_DAYS * 86400000
  db.items = db.items.filter(it => (it.fetchedAt || 0) >= cutoff || (it.publishedTs || 0) >= cutoff)
  if (db.items.length > MAX_ITEMS) db.items = db.items.slice(0, MAX_ITEMS)
  db.briefs = (db.briefs || []).filter(b => (b.createdAt || 0) >= cutoff)
}
function uid(p) { return p + crypto.randomBytes(5).toString('hex') }

/* ---------- HTTP 抓取（容忍自签/GBK/重定向） ---------- */
function fetchUrl(url, opts) {
  opts = opts || {}
  const timeout = opts.timeout || 15000, max = opts.max || 2 * 1024 * 1024
  return new Promise((resolve, reject) => {
    let redirects = 0
    function go(u) {
      let parsed; try { parsed = new URL(u) } catch (e) { return reject(new Error('URL 非法')) }
      const mod = parsed.protocol === 'https:' ? https : http
      const req = mod.get(u, { timeout, headers: { 'User-Agent': UA, 'Accept': '*/*' }, rejectUnauthorized: false }, res => {
        const code = res.statusCode || 0
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && redirects < 3) { redirects++; res.resume(); return go(new URL(res.headers.location, u).href) }
        const enc = /charset=["']?([\w-]+)/i.exec((res.headers['content-type'] || ''))[1] || ''
        const chunks = []; let size = 0
        res.on('data', c => { size += c.length; if (size > max) { req.destroy() } else chunks.push(c) })
        res.on('end', () => { const buf = Buffer.concat(chunks); resolve({ status: code, contentType: res.headers['content-type'] || '', buf, enc }) })
        res.on('error', reject)
      })
      req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')))
    }
    go(url)
  })
}
function decode(buf, enc) {
  const e = (enc || '').toLowerCase()
  try { if (e && (e.indexOf('gb') >= 0 || e === 'gb2312' || e === 'gbk' || e === 'gb18030')) return new TextDecoder('gbk').decode(buf) } catch (_) {}
  return buf.toString('utf8')
}

/* ---------- 解析 ---------- */
function unesc(s) { return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&') }
function stripTags(s) { return unesc(String(s || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }
function parseFeed(xml) {
  const out = []
  const itemRe = /<item[\s\S]*?<\/item>/gi, entryRe = /<entry[\s\S]*?<\/entry>/gi
  const blocks = xml.match(itemRe) || xml.match(entryRe) || []
  for (const b of blocks.slice(0, 40)) {
    const g = re => { const m = re.exec(b); return m ? unesc(m[1]).trim() : '' }
    let title = g(/<title[^>]*>([\s\S]*?)<\/title>/i)
    let link = g(/<link[^>]*href=["']([^"']+)["']/i) || g(/<link[^>]*>([\s\S]*?)<\/link>/i)
    link = stripTags(link)
    const desc = g(/<description[^>]*>([\s\S]*?)<\/description>/i) || g(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || g(/<content[^>]*>([\s\S]*?)<\/content>/i)
    const date = g(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || g(/<published[^>]*>([\s\S]*?)<\/published>/i) || g(/<updated[^>]*>([\s\S]*?)<\/updated>/i) || g(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i)
    if (!title && !link) continue
    let ts = 0; const dt = date ? new Date(date) : null; if (dt && !isNaN(dt)) ts = dt.getTime()
    out.push({ title: title.slice(0, 200), url: link, summary: stripTags(desc).slice(0, 400), publishedTs: ts, published: ts ? new Date(ts).toISOString().slice(0, 16).replace('T', ' ') : '' })
  }
  return out
}
function extractArticle(html) {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html); const title = t ? stripTags(t[1]).slice(0, 200) : ''
  const d = /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i.exec(html) || /<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i.exec(html)
  const desc = d ? stripTags(d[1]) : ''
  let body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  body = unesc(body).replace(/\s+/g, ' ').trim()
  return { title, desc, text: body.slice(0, 6000) }
}

/* ---------- OpenRouter ---------- */
async function ai(system, user, maxTokens) {
  if (!OR_KEY) throw new Error('未配置 OPENROUTER_API_KEY')
  const ctl = new AbortController()
  const to = setTimeout(() => { try { ctl.abort() } catch (_) {} }, Number(process.env.MARKET_AI_TIMEOUT_MS || 120000))
  try {
    const r = await fetch(OR_URL + '/chat/completions', {
      method: 'POST', headers: { 'authorization': 'Bearer ' + OR_KEY, 'content-type': 'application/json', 'x-title': 'Presales Market' },
      body: JSON.stringify({ model: OR_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens || 1000, temperature: 0.3 }),
      signal: ctl.signal,
    })
    if (!r.ok) throw new Error('OpenRouter ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 150))
    const j = await r.json()
    return ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim()
  } catch (e) {
    if (e && (e.name === 'AbortError' || /abort/i.test(String(e && e.message)))) throw new Error('AI 生成超时，请稍后重试')
    throw e
  } finally { clearTimeout(to) }
}
const SYS_MARKET = '你是售前团队的市场情报分析助手。用中文、简洁专业、只依据给定材料，不编造。输出用轻量 Markdown（可用小标题、列表、表格）。'

/* ---------- 抓取任务 ---------- */
async function runFetch() {
  const seen = new Set(db.items.map(i => i.url).filter(Boolean))
  let added = 0
  for (const s of db.sources.filter(x => x.active !== false)) {
    try {
      const res = await fetchUrl(s.url)
      if (!res.buf || res.status >= 400) continue
      const xml = decode(res.buf, res.enc || res.contentType)
      if (!/<(rss|feed)/i.test(xml.slice(0, 500))) continue
      for (const it of parseFeed(xml)) {
        if (!it.url || seen.has(it.url)) continue
        seen.add(it.url); added++
        db.items.unshift({ id: uid('i'), sourceId: s.id, sourceName: s.name, title: it.title, url: it.url, summary: it.summary, published: it.published, publishedTs: it.publishedTs, points: [], fetchedAt: Date.now() })
      }
    } catch (e) { LOG('抓取源失败 ' + s.name + '：' + e.message) }
  }
  prune(); db.lastRun = Date.now(); save()
  return { added, total: db.items.length }
}
async function makeDigest() {
  const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  const today = db.items.filter(i => new Date((i.publishedTs || i.fetchedAt) + 8 * 3600e3).toISOString().slice(0, 10) === day)
  const pool = (today.length ? today : db.items).slice(0, 40)
  if (!pool.length) return null
  const mat = pool.map(i => '- ' + i.title + '（' + i.sourceName + '）' + (i.summary ? '：' + i.summary.slice(0, 80) : '')).join('\n')
  let out = ''
  try { out = await ai(SYS_MARKET + ' 请生成「每日市场动态简报」：先 3-5 条要点综述，再按【政策/技术趋势】【竞品/厂商动态】【其他值得关注】归类点名，最后给售前 1-2 条行动建议。控制在 500 字内。', '今日资讯：\n' + mat, 900) } catch (e) { out = '（AI 摘要生成失败：' + e.message + '）' }
  const ex = db.briefs.find(b => b.type === 'digest' && b.title === '每日市场动态 · ' + day)
  const rec = { id: ex ? ex.id : uid('b'), type: 'digest', title: '每日市场动态 · ' + day, output: out, createdAt: Date.now() }
  if (ex) Object.assign(ex, rec); else db.briefs.unshift(rec)
  prune(); save(); return rec
}
let _running = false
async function dailyTick() {
  const now = new Date(Date.now() + 8 * 3600e3)
  const day = now.toISOString().slice(0, 10)
  if (now.getUTCHours() < 8) return
  if (new Date(db.lastRun + 8 * 3600e3).toISOString().slice(0, 10) === day) return
  if (_running) return
  _running = true
  try { LOG('市场情报：开始每日抓取'); const r = await runFetch(); await makeDigest(); LOG('市场情报：每日抓取完成，新增 ' + r.added + ' 条') } catch (e) { LOG('每日抓取异常：' + e.message) } finally { _running = false }
}
function startScheduler() { setInterval(() => { dailyTick().catch(() => {}) }, 30 * 60 * 1000); setTimeout(() => dailyTick().catch(() => {}), 8000) }

/* ---------- HTTP API ---------- */
function send(res, code, obj) { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': b.length }); res.end(b) }
function readJson(req) { return new Promise((resolve, reject) => { let n = 0; const ch = []; req.on('data', c => { n += c.length; if (n > 4e6) { reject(new Error('过大')); req.destroy(); return } ch.push(c) }); req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(ch).toString('utf8') || '{}')) } catch (e) { reject(e) } }); req.on('error', reject) }) }
function stats() { const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); const today = db.items.filter(i => new Date((i.publishedTs || i.fetchedAt) + 8 * 3600e3).toISOString().slice(0, 10) === day).length; return { total: db.items.length, today, sources: db.sources.length, lastRun: db.lastRun } }

async function handle(req, res, p) {
  const method = req.method
  try {
    if (p === '/api/market' && method === 'GET') return send(res, 200, { ok: true, sources: db.sources, items: db.items.slice(0, 300), briefs: (db.briefs || []).slice(0, 60), stats: stats() })
    if (p === '/api/market/source' && method === 'POST') { const b = await readJson(req); const url = String(b.url || '').trim(); const name = String(b.name || '').trim() || url; if (!/^https?:\/\//.test(url)) return send(res, 400, { error: '请输入 http(s) 源地址' }); db.sources.push({ id: uid('s'), name: name.slice(0, 40), url, active: true }); save(); return send(res, 200, { ok: true }) }
    if (p.startsWith('/api/market/source/') && method === 'PUT') { const id = decodeURIComponent(p.slice('/api/market/source/'.length)); const s = db.sources.find(x => x.id === id); if (!s) return send(res, 404, { error: '源不存在' }); const b = await readJson(req); if (b.name) s.name = String(b.name).slice(0, 40); if (b.url) s.url = String(b.url); if (b.active !== undefined) s.active = !!b.active; save(); return send(res, 200, { ok: true }) }
    if (p.startsWith('/api/market/source/') && method === 'DELETE') { const id = decodeURIComponent(p.slice('/api/market/source/'.length)); db.sources = db.sources.filter(x => x.id !== id); save(); return send(res, 200, { ok: true }) }
    if (p === '/api/market/fetch' && method === 'POST') { if (_running) return send(res, 409, { error: '抓取进行中，请稍候' }); _running = true; try { const r = await runFetch(); return send(res, 200, { ok: true, ...r }) } finally { _running = false } }
    if (p === '/api/market/digest' && method === 'POST') { const r = await makeDigest(); return send(res, 200, { ok: true, brief: r }) }
    if (p === '/api/market/import' && method === 'POST') {
      const b = await readJson(req); const url = String(b.url || '').trim(); const rawText = String(b.text || '').trim(); let title = '', text = ''
      if (url) { const resu = await fetchUrl(url, { timeout: 20000 }); if (resu.status >= 400) return send(res, 400, { error: '抓取失败 HTTP ' + resu.status }); const html = decode(resu.buf, resu.enc || resu.contentType); const a = extractArticle(html); title = a.title; text = a.text }
      else if (rawText) { text = rawText.slice(0, 6000); title = String(b.title || '').trim() || text.slice(0, 30) }
      else return send(res, 400, { error: '请提供 URL 或原文' })
      if (!text) return send(res, 400, { error: '未提取到正文' })
      let points = ''; try { points = await ai(SYS_MARKET + ' 请从下面材料中提炼 3-6 条对售前/投标有价值的要点（每条一行，前缀“· ”），并标注类型（政策/竞品/技术/市场）。', '标题：' + title + '\n\n正文：' + text, 600) } catch (e) { points = '（要点提炼失败：' + e.message + '）' }
      const item = { id: uid('i'), sourceId: 'manual', sourceName: url ? '手动抓取' : '手动录入', title: title.slice(0, 200), url: url || '', summary: (b.summary || text).slice(0, 300), points, published: new Date().toISOString().slice(0, 16).replace('T', ' '), publishedTs: Date.now(), fetchedAt: Date.now() }
      db.items.unshift(item); prune(); save(); return send(res, 200, { ok: true, item })
    }
    if (p === '/api/market/organize' && method === 'POST') {
      const b = await readJson(req); const type = b.type === 'compare' ? 'compare' : 'brief'
      let mat = ''
      if (Array.isArray(b.itemIds) && b.itemIds.length) { const set = new Set(b.itemIds); mat = db.items.filter(i => set.has(i.id)).map(i => '【' + i.title + '】' + (i.points ? '\n' + i.points : (i.summary || ''))).join('\n\n').slice(0, 8000) }
      else mat = String(b.text || '').slice(0, 8000)
      if (!mat.trim()) return send(res, 400, { error: '没有可用于整理的素材（请选择条目或粘贴内容）' })
      const title = String(b.title || '').trim() || (type === 'compare' ? '竞品对比' : '行业简报')
      let out
      const task = type === 'compare'
        ? '请基于材料生成「竞品对比表」：用 Markdown 表格，行=各竞品/我方，列=关键维度（定位、核心产品、技术能力、价格/报价、优劣势、适配场景等，按材料可得信息），表格后补 3-5 条我方应对要点。材料缺失的维度填“—”，不要编造。'
        : '请基于材料生成一份「行业简报」：小标题分节（政策/环境、技术趋势、竞品与厂商动态、对售前投标的启示），要点式，控制在 600 字内。'
      try { out = await ai(SYS_MARKET + ' ' + task, mat, 1100) } catch (e) { return send(res, 502, { error: 'AI 整理失败：' + e.message }) }
      const brief = { id: uid('b'), type, title, output: out, refs: b.itemIds || [], createdAt: Date.now() }
      db.briefs.unshift(brief); prune(); save(); return send(res, 200, { ok: true, brief })
    }
    if (p.startsWith('/api/market/item/') && method === 'DELETE') { const id = decodeURIComponent(p.slice('/api/market/item/'.length)); db.items = db.items.filter(i => i.id !== id); save(); return send(res, 200, { ok: true }) }
    if (p.startsWith('/api/market/brief/') && method === 'DELETE') { const id = decodeURIComponent(p.slice('/api/market/brief/'.length)); db.briefs = (db.briefs || []).filter(i => i.id !== id); save(); return send(res, 200, { ok: true }) }
    return send(res, 404, { error: 'no such market api' })
  } catch (e) { LOG('market 处理异常：' + (e && e.stack || e)); return send(res, 500, { error: String((e && e.message) || e) }) }
}

module.exports = { init, handle, startScheduler, DEFAULT_SOURCES }
