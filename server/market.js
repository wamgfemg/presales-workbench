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
  { name: '开源中国', url: 'https://www.oschina.net/news/rss' },
  { name: '极客公园', url: 'https://www.geekpark.net/rss' },
  { name: '钛媒体', url: 'https://www.tmtpost.com/rss.xml' },
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
async function ai(system, user, maxTokens, model) {
  if (!OR_KEY) throw new Error('未配置 OPENROUTER_API_KEY')
  const ctl = new AbortController()
  const to = setTimeout(() => { try { ctl.abort() } catch (_) {} }, Number(process.env.MARKET_AI_TIMEOUT_MS || 120000))
  try {
    const r = await fetch(OR_URL + '/chat/completions', {
      method: 'POST', headers: { 'authorization': 'Bearer ' + OR_KEY, 'content-type': 'application/json', 'x-title': 'Presales Market' },
      body: JSON.stringify({ model: model || OR_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens || 1000, temperature: 0.3 }),
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
const OPS_KW = ['运维', '监控', '可观测', 'observability', 'apm', 'aiops', 'itom', 'itsm', 'cmdb', '自动化运维', '运维平台', '运维服务', '告警', '日志', '链路追踪', '云运维', 'sre', 'devops', '稳定性', '故障', '巡检', '资产管理', '智能运维', '一体化运维', '监控平台', '运维管理', '数据中心运维', 'ITOM']
function isOpsRelevant(t) { t = String(t || '').toLowerCase(); for (const k of OPS_KW) { if (t.indexOf(k) >= 0) return true } return false }
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
        if (!it.url || seen.has(it.url) || !isOpsRelevant(it.title + ' ' + (it.summary || ''))) continue
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
  try { out = await ai(SYS_MARKET + ' 请生成「IT运维市场每日简报」：先 3-5 条要点综述，聚焦【运维平台/工具市场】【运维服务市场】【AIOps·可观测·自动化技术趋势】【厂商与并购】并点名相关厂商，最后给售前投标 1-2 条行动建议。控制在 500 字内。', '今日资讯：\n' + mat, 900) } catch (e) { out = '（AI 摘要生成失败：' + e.message + '）' }
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
        ? '请输出一份专业的「运维厂商 / 平台 / 服务 对比分析报告」，用 Markdown，结构：\n## 核心结论\n（2-3 句概述我方相对位置与关键判断）\n## 对比矩阵\n用表格：首列为对比维度（产品定位、核心功能、技术与架构、信创/合规适配、性能与稳定性、价格/报价、交付与服务、生态与案例、综合优劣势），其余列为我方及各竞品；单元格写要点，材料没有的填“—”，不得编造数字。\n## 我方优势\n（2-4 条）\n## 我方短板与风险\n（2-4 条）\n## 应对与打法建议\n（3-5 条，落到可执行动作）\n## 数据说明\n（一行，说明信息来源与缺口）'
        : '请输出一份专业的「IT运维市场简报」，用 Markdown，结构：\n## 执行摘要\n（3-4 句要点）\n## 运维平台 / 工具市场\n## 运维服务市场\n## 技术趋势（AIOps / 可观测 / 自动化）\n## 厂商与竞争动态\n## 对售前投标的启示\n（3-5 条可执行建议）\n## 信息来源\n（列出所依据的条目标题）\n聚焦 IT 运维领域，只依据给定材料，缺失不编造，控制在 700 字内。'
      try { out = await ai(SYS_MARKET + ' ' + task, mat, 1600) } catch (e) { return send(res, 502, { error: 'AI 整理失败：' + e.message }) }
      const brief = { id: uid('b'), type, title, output: out, refs: b.itemIds || [], createdAt: Date.now() }
      db.briefs.unshift(brief); prune(); save(); return send(res, 200, { ok: true, brief })
    }
    if (p.startsWith('/api/market/item/') && method === 'DELETE') { const id = decodeURIComponent(p.slice('/api/market/item/'.length)); db.items = db.items.filter(i => i.id !== id); save(); return send(res, 200, { ok: true }) }
    if (p.startsWith('/api/market/brief/') && method === 'DELETE') { const id = decodeURIComponent(p.slice('/api/market/brief/'.length)); db.briefs = (db.briefs || []).filter(i => i.id !== id); save(); return send(res, 200, { ok: true }) }
    if (p === '/api/market/ops-news' && method === 'POST') {
      if (!OR_KEY) return send(res, 503, { error: '未配置 OPENROUTER_API_KEY' })
      const model = process.env.VENDOR_NEWS_MODEL || 'perplexity/sonar-pro-search'
      const prompt = '请联网检索中国「IT运维 / 运维平台 / 运维服务 / 可观测 / AIOps / 智能运维」市场最近 1-2 个月的 5-8 条真实动态（厂商产品发布、融资并购、市场报告、合作签约、政策）。严格每行一条，格式：日期(YYYY-MM)|标题|一句话摘要|来源网址。只输出条目行，不要多余文字。'
      const reqBody = { model, messages: [{ role: 'system', content: '行业情报检索助手，联网检索据实回答，给可核实来源，不编造。' }, { role: 'user', content: prompt }], max_tokens: 1200, temperature: 0.2 }
      if (!/sonar|perplexity/i.test(model)) reqBody.plugins = [{ id: 'web', max_results: 6 }]
      const ctl = new AbortController(); const to = setTimeout(() => { try { ctl.abort() } catch (_) {} }, Number(process.env.VENDOR_NEWS_TIMEOUT_MS || 90000))
      let txt = '', ann = []
      try {
        const r = await fetch(OR_URL + '/chat/completions', { method: 'POST', headers: { 'authorization': 'Bearer ' + OR_KEY, 'content-type': 'application/json', 'x-title': 'Ops News' }, body: JSON.stringify(reqBody), signal: ctl.signal })
        if (!r.ok) return send(res, 502, { error: 'AI 检索失败 ' + r.status })
        const j = await r.json(); const msg = (j.choices && j.choices[0] && j.choices[0].message) || {}
        txt = msg.content || ''; ann = msg.annotations || []
      } catch (e) { return send(res, 502, { error: 'AI 检索失败：' + ((e && e.message) || e) }) } finally { clearTimeout(to) }
      const isUrl = function (x) { return /^https?:\/\/\S+$/.test(x) }
      const seen = new Set(db.items.map(i => i.url).filter(Boolean)); let added = 0
      String(txt).split(/\r?\n/).map(function (l) { return l.trim() }).filter(function (l) { return l && l.indexOf('|') >= 0 }).forEach(function (l, idx) {
        const pp = l.split('|').map(function (x) { return x.trim() }); if (!pp[1]) return
        let url = (pp[3] || '').trim(); if (!isUrl(url)) url = (ann[idx] && ann[idx].url_citation && ann[idx].url_citation.url) || ''
        if (url && seen.has(url)) return; if (url) seen.add(url)
        added++; db.items.unshift({ id: uid('i'), sourceId: 'ai', sourceName: 'AI联网', title: (pp[1] || '').slice(0, 200), url: url, summary: (pp[2] || '').slice(0, 400), published: (pp[0] || '').slice(0, 12), publishedTs: 0, points: '', fetchedAt: Date.now() })
      })
      prune(); save(); return send(res, 200, { ok: true, added, total: db.items.length })
    }
    if (p === '/api/market/vendor-news' && method === 'POST') {
      const b = await readJson(req); const name = String(b.vendor || '').trim(); if (!name) return send(res, 400, { error: '缺少厂商名' })
      const desc = String(b.description || '').slice(0, 200), alias = String(b.aliases || '').slice(0, 120)
      const model = process.env.VENDOR_NEWS_MODEL || 'perplexity/sonar-pro-search'
      const prompt = '请联网检索中国 IT 运维 / 数据中心 / AI 领域厂商「' + name + '」' + (desc ? '（' + desc + '）' : '') + (alias ? '，别名 ' + alias : '') + ' 最近的 3-5 条真实动态（产品发布 / 融资并购 / 合作签约 / 市场与技术进展），优先近 1-2 年、越新越好。严格每行一条，格式：日期(YYYY-MM 或 YYYY-MM-DD)|标题|一句话摘要|来源网址。只输出条目行，不要多余文字；每条尽量给真实可访问来源网址；完全查不到就只输出一行：未知|暂无可靠动态|—|'
      const reqBody = { model, messages: [{ role: 'system', content: '你是行业情报检索助手，联网检索后据实回答，给出可核实来源，不编造。' }, { role: 'user', content: prompt }], max_tokens: 900, temperature: 0.2 }
      if (!/sonar|perplexity/i.test(model)) reqBody.plugins = [{ id: 'web', max_results: 5 }]
      const ctl = new AbortController(); const to = setTimeout(() => { try { ctl.abort() } catch (_) {} }, Number(process.env.VENDOR_NEWS_TIMEOUT_MS || 90000))
      let txt = '', cites = []
      try {
        const r = await fetch(OR_URL + '/chat/completions', { method: 'POST', headers: { 'authorization': 'Bearer ' + OR_KEY, 'content-type': 'application/json', 'x-title': 'Vendor News' }, body: JSON.stringify(reqBody), signal: ctl.signal })
        if (!r.ok) return send(res, 502, { error: 'AI 检索失败 ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 150) })
        const j2 = await r.json(); const msg = (j2.choices && j2.choices[0] && j2.choices[0].message) || {}
        txt = msg.content || ''
        const ann = msg.annotations || (j2.choices && j2.choices[0] && j2.choices[0].annotations) || []
        cites = ann.map(function (a) { return (a && a.url_citation) ? { url: a.url_citation.url, title: a.url_citation.title || '' } : (a && a.url ? { url: a.url, title: a.title || '' } : null) }).filter(Boolean)
      } catch (e) { return send(res, 502, { error: 'AI 检索失败：' + ((e && e.message) || e) }) } finally { clearTimeout(to) }
      const isUrl = function (x) { return /^https?:\/\/\S+$/.test(x) }
      const items = String(txt).split(/\r?\n/).map(function (l) { return l.trim() }).filter(function (l) { return l && l.indexOf('|') >= 0 }).map(function (l, idx) {
        const pp = l.split('|').map(function (x) { return x.trim() }); if (!pp[0] || pp[0].indexOf('未知') >= 0) return null
        let url = (pp[3] || '').trim(); if (!isUrl(url)) url = ''
        if (!url && cites[idx]) url = cites[idx].url
        return { date: (pp[0] || '').slice(0, 12), title: (pp[1] || '').slice(0, 120), summary: (pp[2] || '').slice(0, 300), url: (url || '').slice(0, 400), source: 'AI联网' }
      }).filter(Boolean)
      return send(res, 200, { ok: true, items, citations: cites.slice(0, 8) })
    }
    return send(res, 404, { error: 'no such market api' })
  } catch (e) { LOG('market 处理异常：' + (e && e.stack || e)); return send(res, 500, { error: String((e && e.message) || e) }) }
}

module.exports = { init, handle, startScheduler, DEFAULT_SOURCES }
