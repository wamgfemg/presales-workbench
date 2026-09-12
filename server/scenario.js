'use strict'
/* 解决方案创新场景：抓取软件解决方案/创新场景资讯（RSS + 手动 URL/原文），AI 提炼成结构化「创新场景卡」，存 data/scenario.json。零第三方依赖。 */
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const https = require('node:https')
const crypto = require('node:crypto')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
const RETENTION_DAYS = Number(process.env.SCENARIO_RETENTION_DAYS || 120)
const MAX_ITEMS = Number(process.env.SCENARIO_MAX_ITEMS || 600)
const MAX_CARDS = Number(process.env.SCENARIO_MAX_CARDS || 300)
const OR_URL = (process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
const OR_KEY = process.env.OPENROUTER_API_KEY || ''
const OR_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat'

let DATA_DIR, LOG, FILE, db = null
const DEFAULT_SOURCES = [
  { name: '量子位', url: 'https://www.qbitai.com/feed' },
  { name: '雷峰网', url: 'https://www.leiphone.com/feed' },
  { name: 'InfoQ 中文', url: 'https://www.infoq.cn/feed' },
]

function init(opts) { DATA_DIR = opts.DATA_DIR; LOG = opts.log || function () {}; FILE = path.join(DATA_DIR, 'scenario.json'); load() }
function load() { try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch (_) { db = null } if (!db || !Array.isArray(db.cards)) { db = { sources: DEFAULT_SOURCES.map((s, i) => ({ id: 's' + (i + 1), name: s.name, url: s.url, active: true })), items: [], cards: [], lastRun: 0 }; save() } }
function save() { try { const t = FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(db)); fs.renameSync(t, FILE) } catch (e) { LOG('保存 scenario 失败：' + e.message) } }
function prune() { const cut = Date.now() - RETENTION_DAYS * 86400000; db.items = db.items.filter(i => (i.fetchedAt || 0) >= cut); if (db.items.length > MAX_ITEMS) db.items = db.items.slice(0, MAX_ITEMS); db.cards = db.cards.filter(c => (c.createdAt || 0) >= cut); if (db.cards.length > MAX_CARDS) db.cards = db.cards.slice(0, MAX_CARDS) }
function uid(p) { return p + crypto.randomBytes(5).toString('hex') }

function fetchUrl(url, opts) {
  opts = opts || {}; const timeout = opts.timeout || 20000, max = opts.max || 4 * 1024 * 1024
  return new Promise((resolve, reject) => {
    let redirects = 0
    function go(u) {
      let parsed; try { parsed = new URL(u) } catch (e) { return reject(new Error('URL 非法')) }
      const mod = parsed.protocol === 'https:' ? https : http
      const rq = mod.get(u, { timeout, headers: { 'User-Agent': UA, 'Accept': '*/*' }, rejectUnauthorized: false }, res => {
        const code = res.statusCode || 0
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && redirects < 3) { redirects++; res.resume(); return go(new URL(res.headers.location, u).href) }
        const chunks = []; let size = 0
        res.on('data', c => { size += c.length; if (size > max) rq.destroy(); else chunks.push(c) })
        res.on('end', () => resolve({ status: code, buf: Buffer.concat(chunks), ct: res.headers['content-type'] || '' }))
        res.on('error', reject)
      })
      rq.on('error', reject); rq.on('timeout', () => rq.destroy(new Error('timeout')))
    }
    go(url)
  })
}
function unesc(s) { return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#\d+;/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&') }
function stripTags(s) { return unesc(String(s || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }
function parseFeed(xml) {
  const out = []; const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || []
  for (const b of blocks.slice(0, 30)) {
    const g = re => { const m = re.exec(b); return m ? stripTags(m[1]).trim() : '' }
    let title = g(/<title[^>]*>([\s\S]*?)<\/title>/i)
    let link = g(/<link[^>]*href=["']([^"']+)["']/i) || g(/<link[^>]*>([\s\S]*?)<\/link>/i)
    const desc = g(/<description[^>]*>([\s\S]*?)<\/description>/i) || g(/<summary[^>]*>([\s\S]*?)<\/summary>/i)
    const date = g(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || g(/<published[^>]*>([\s\S]*?)<\/published>/i) || g(/<updated[^>]*>([\s\S]*?)<\/updated>/i)
    if (!title && !link) continue
    let ts = 0; const dt = date ? new Date(date) : null; if (dt && !isNaN(dt)) ts = dt.getTime()
    out.push({ title: title.slice(0, 200), url: link, summary: stripTags(desc).slice(0, 400), publishedTs: ts, published: ts ? new Date(ts).toISOString().slice(0, 16).replace('T', ' ') : '' })
  }
  return out
}
function extractArticle(html) {
  function g(pats) { for (const p of pats) { const m = new RegExp(p, 's').exec(html); if (m) return stripTags(m[1]) } return '' }
  const title = g(['id="activity-name"[^>]*>([\\s\\S]*?)</h1>', 'og:title" content="([^"]*)"', '<title[^>]*>([\\s\\S]*?)</title>', '<h1[^>]*>([\\s\\S]*?)</h1>'])
  let body = ''
  const i = html.indexOf('id="js_content"')
  if (i > 0) { let seg = html.slice(i, i + 300000); for (const end of ['rich_media_tool', 'js_pc_qr_code', 'var msg_title']) { const j = seg.indexOf(end); if (j > 0) seg = seg.slice(0, j) } body = stripTags(seg) }
  else { let seg = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' '); body = stripTags(seg) }
  return { title, body: body.slice(0, 8000) }
}

async function ai(system, user, maxTokens) {
  if (!OR_KEY) throw new Error('未配置 OPENROUTER_API_KEY')
  const ctl = new AbortController(); const to = setTimeout(() => { try { ctl.abort() } catch (_) {} }, Number(process.env.SCENARIO_AI_TIMEOUT_MS || 120000))
  try {
    const r = await fetch(OR_URL + '/chat/completions', { method: 'POST', headers: { 'authorization': 'Bearer ' + OR_KEY, 'content-type': 'application/json', 'x-title': 'Presales Scenario' }, body: JSON.stringify({ model: OR_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens || 1200, temperature: 0.3 }), signal: ctl.signal })
    if (!r.ok) throw new Error('OpenRouter ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 150))
    const j = await r.json(); return ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim()
  } catch (e) { if (e && (e.name === 'AbortError' || /abort/i.test(String(e && e.message)))) throw new Error('AI 提炼超时，请稍后重试'); throw e } finally { clearTimeout(to) }
}
const SYS = '你是售前解决方案专家。用中文、专业简洁、只依据给定材料提炼，不编造。输出用轻量 Markdown。'
const CARD_TASK = '请从材料中提炼一个「企业 AI 落地场景卡」——只聚焦企业级 AI 的具体落地应用（不是泛泛行业新闻）。用 Markdown，结构：\n## 场景名称\n## 行业 / 客户类型\n## 业务问题（AI 要解决的具体痛点）\n## AI 能力与模型（用了什么大模型 / Agent / RAG / 多模态等）\n## 数据与系统集成\n## 落地方式与技术栈\n## 效果与量化收益\n## 对我方方案的借鉴点\n（2-4 条可复用、可写进投标/方案的要点）\n## 来源\n若材料并非企业 AI 落地场景，请在“场景名称”下直接写“非企业 AI 落地场景”并停止编造；缺失信息填"—"。只依据材料，控制在 500 字内。'

const AI_KW_CN = ['人工智能', '大模型', '生成式', '智能体', '机器学习', '深度学习', '多模态', '文生图', '文生视频', '数字人', '智能问答', '知识库', '行业模型', '企业级', '落地场景', '落地应用', '赋能', 'AIGC', 'RAG', 'Agent', 'Copilot', 'LLM', 'GPT', 'Transformer', 'NLP', 'MLOps', '向量', '微调', '推理', '算力', 'DeepSeek', 'Kimi', '豆包', '通义', '文心', 'Qwen', 'Claude', 'Gemini', 'OpenAI', 'Anthropic', '智谱', '具身智能', '世界模型']
function isRelevant(text) {
  const t = String(text || ''); const low = t.toLowerCase()
  if (/AI/.test(t)) return true
  for (const k of AI_KW_CN) { if (t.indexOf(k) >= 0) return true }
  for (const k of ['llm', 'aigc', 'agent', 'rag', 'copilot', 'gpt', 'nlp', 'mlops', 'transformer', 'chatgpt']) { if (low.indexOf(k) >= 0) return true }
  return false
}
async function runFetch() { const seen = new Set(db.items.map(i => i.url).filter(Boolean)); let added = 0; for (const s of db.sources.filter(x => x.active !== false)) { try { const res = await fetchUrl(s.url); if (!res.buf || res.status >= 400) continue; const xml = res.buf.toString('utf8'); if (!/<(rss|feed)/i.test(xml.slice(0, 500))) continue; for (const it of parseFeed(xml)) { if (!it.url || seen.has(it.url) || !isRelevant(it.title + ' ' + (it.summary || ''))) continue; seen.add(it.url); added++; db.items.unshift({ id: uid('i'), sourceName: s.name, title: it.title, url: it.url, summary: it.summary, published: it.published, publishedTs: it.publishedTs, fetchedAt: Date.now() }) } } catch (e) { LOG('scenario 源失败 ' + s.name + '：' + e.message) } } prune(); db.lastRun = Date.now(); save(); return { added, total: db.items.length } }
let _running = false
async function dailyTick() { const now = new Date(Date.now() + 8 * 3600e3); if (now.getUTCHours() < 9 || (now.getUTCHours() === 9 && now.getUTCMinutes() < 15)) return; const day = now.toISOString().slice(0, 10); if (new Date(db.lastRun + 8 * 3600e3).toISOString().slice(0, 10) === day) return; if (_running) return; _running = true; try { const r = await runFetch(); LOG('创新场景：每日抓取完成，新增 ' + r.added) } catch (e) { LOG('创新场景定时异常：' + e.message) } finally { _running = false } }
function startScheduler() { setInterval(() => { dailyTick().catch(() => {}) }, 30 * 60 * 1000); setTimeout(() => dailyTick().catch(() => {}), 14000) }

async function buildCard(b) {
  let title = String(b.title || '').trim(), text = String(b.text || '').trim(), url = String(b.url || '').trim()
  if (b.itemId) { const it = db.items.find(x => x.id === b.itemId); if (it) { title = title || it.title; url = url || it.url; text = text || ((it.summary || '') + '\n' + (it.title || '')) } }
  if (url && !text) { const res = await fetchUrl(url, { timeout: 20000 }); if (res.status >= 400) throw new Error('抓取失败 HTTP ' + res.status); const a = extractArticle(res.buf.toString('utf8')); title = title || a.title; text = a.body }
  if (!text || text.length < 30) throw new Error('未提取到足够内容（可改为粘贴原文）')
  let output; try { output = await ai(SYS, CARD_TASK + '\n\n=== 材料 ===\n标题：' + (title || '（无）') + '\n' + text.slice(0, 8000), 1200) } catch (e) { output = '（AI 提炼失败：' + e.message + '）' }
  const card = { id: uid('c'), title: (title || '创新场景').slice(0, 120), url, output, createdAt: Date.now() }
  db.cards.unshift(card); prune(); save(); return card
}

function send(res, code, obj) { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': b.length }); res.end(b) }
function readJson(req) { return new Promise((resolve, reject) => { let n = 0; const ch = []; req.on('data', c => { n += c.length; if (n > 4e6) { reject(new Error('过大')); req.destroy(); return } ch.push(c) }); req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(ch).toString('utf8') || '{}')) } catch (e) { reject(e) } }); req.on('error', reject) }) }

async function handle(req, res, p) {
  const method = req.method
  try {
    if (p === '/api/scenario' && method === 'GET') return send(res, 200, { ok: true, sources: db.sources, items: db.items.slice(0, 200), cards: db.cards.slice(0, 120), stats: { items: db.items.length, cards: db.cards.length, lastRun: db.lastRun } })
    if (p === '/api/scenario/source' && method === 'POST') { const b = await readJson(req); const url = String(b.url || '').trim(); if (!/^https?:\/\//.test(url)) return send(res, 400, { error: '请输入 http(s) 源地址' }); db.sources.push({ id: uid('s'), name: (String(b.name || '').trim() || url).slice(0, 40), url, active: true }); save(); return send(res, 200, { ok: true }) }
    if (p.startsWith('/api/scenario/source/') && method === 'DELETE') { const id = decodeURIComponent(p.slice('/api/scenario/source/'.length)); db.sources = db.sources.filter(s => s.id !== id); save(); return send(res, 200, { ok: true }) }
    if (p === '/api/scenario/fetch' && method === 'POST') { if (_running) return send(res, 409, { error: '抓取中，请稍候' }); _running = true; try { const r = await runFetch(); return send(res, 200, { ok: true, ...r }) } finally { _running = false } }
    if (p === '/api/scenario/card' && method === 'POST') { const b = await readJson(req); const card = await buildCard(b); return send(res, 200, { ok: true, card }) }
    if (p.startsWith('/api/scenario/card/') && method === 'DELETE') { const id = decodeURIComponent(p.slice('/api/scenario/card/'.length)); db.cards = db.cards.filter(c => c.id !== id); save(); return send(res, 200, { ok: true }) }
    if (p.startsWith('/api/scenario/item/') && method === 'DELETE') { const id = decodeURIComponent(p.slice('/api/scenario/item/'.length)); db.items = db.items.filter(i => i.id !== id); save(); return send(res, 200, { ok: true }) }
    return send(res, 404, { error: 'no such scenario api' })
  } catch (e) { LOG('scenario 异常：' + (e && e.stack || e)); return send(res, 500, { error: String((e && e.message) || e) }) }
}
module.exports = { init, handle, startScheduler }
