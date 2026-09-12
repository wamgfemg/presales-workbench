'use strict'
/* AI应用日报：抓取「静言波语」等公众号发布的《企业级AI应用日报》文章，AI 整理成结构化日报并归档展示。
 * 微信无 RSS、每篇是固定 /s/ 链接，故按“链接清单”处理：收录新链接→抓取→AI整理→入库；每日定时处理清单中新增链接。零第三方依赖。 */
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const https = require('node:https')
const crypto = require('node:crypto')

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
const RETENTION_DAYS = Number(process.env.AIDAILY_RETENTION_DAYS || 120)
const MAX_REPORTS = Number(process.env.AIDAILY_MAX || 200)
const OR_URL = (process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
const OR_KEY = process.env.OPENROUTER_API_KEY || ''
const OR_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat'

let DATA_DIR, LOG, FILE, db = null

function init(opts) { DATA_DIR = opts.DATA_DIR; LOG = opts.log || function () {}; FILE = path.join(DATA_DIR, 'aidaily.json'); load() }
function load() { try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch (_) { db = null } if (!db || !Array.isArray(db.reports)) { db = { links: [], reports: [], lastRun: 0 }; save() } }
function save() { try { const t = FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(db)); fs.renameSync(t, FILE) } catch (e) { LOG('保存 aidaily 失败：' + e.message) } }
function prune() { const cut = Date.now() - RETENTION_DAYS * 86400000; db.reports = db.reports.filter(r => (r.createdAt || 0) >= cutoffSafe(r) || (r.createdAt || 0) >= cut); if (db.reports.length > MAX_REPORTS) db.reports = db.reports.slice(0, MAX_REPORTS) }
function cutoffSafe(r) { return r.createdAt || 0 }
function uid(p) { return p + crypto.randomBytes(5).toString('hex') }

function fetchUrl(url, opts) {
  opts = opts || {}; const timeout = opts.timeout || 20000, max = opts.max || 6 * 1024 * 1024
  return new Promise((resolve, reject) => {
    let redirects = 0
    function go(u) {
      let parsed; try { parsed = new URL(u) } catch (e) { return reject(new Error('URL 非法')) }
      const mod = parsed.protocol === 'https:' ? https : http
      const rq = mod.get(u, { timeout, headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' }, rejectUnauthorized: false }, res => {
        const code = res.statusCode || 0
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && redirects < 3) { redirects++; res.resume(); return go(new URL(res.headers.location, u).href) }
        const chunks = []; let size = 0
        res.on('data', c => { size += c.length; if (size > max) { rq.destroy() } else chunks.push(c) })
        res.on('end', () => resolve({ status: code, buf: Buffer.concat(chunks) }))
        res.on('error', reject)
      })
      rq.on('error', reject); rq.on('timeout', () => rq.destroy(new Error('timeout')))
    }
    go(url)
  })
}
function stripTags(s) { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim() }
function extractWechat(html) {
  function g(pats) { for (const p of pats) { const m = new RegExp(p, 's').exec(html); if (m) return stripTags(m[1]) } return '' }
  const title = g(['id="activity-name"[^>]*>([\\s\\S]*?)</h1>', 'og:title" content="([^"]*)"', '<title>([\\s\\S]*?)</title>'])
  const nickname = g(['og:article:author" content="([^"]*)"', 'var nickname\\s*=\\s*htmlDecode\\("([^"]*)"\\)', 'var nickname\\s*=\\s*"([^"]*)"', 'id="js_name"[^>]*>([\\s\\S]*?)</a>'])
  const ct = g(['var ct\\s*=\\s*"?(\\d{9,11})"?', 'var create_time\\s*=\\s*"(\\d+)"'])
  let pub = ''
  if (/^\d+$/.test(ct)) { pub = new Date(Number(ct) * 1000 + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') }
  let body = ''
  const i = html.indexOf('id="js_content"')
  if (i > 0) { let seg = html.slice(i, i + 300000); for (const end of ['rich_media_tool', 'js_pc_qr_code', 'var msg_title', 'function clearContent']) { const j = seg.indexOf(end); if (j > 0) seg = seg.slice(0, j) } body = stripTags(seg) }
  return { title, nickname, pub, body }
}

async function ai(system, user, maxTokens) {
  if (!OR_KEY) throw new Error('未配置 OPENROUTER_API_KEY')
  const ctl = new AbortController(); const to = setTimeout(() => { try { ctl.abort() } catch (_) {} }, Number(process.env.AIDAILY_AI_TIMEOUT_MS || 120000))
  try {
    const r = await fetch(OR_URL + '/chat/completions', { method: 'POST', headers: { 'authorization': 'Bearer ' + OR_KEY, 'content-type': 'application/json', 'x-title': 'Presales AI Daily' }, body: JSON.stringify({ model: OR_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens || 1400, temperature: 0.3 }), signal: ctl.signal })
    if (!r.ok) throw new Error('OpenRouter ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 150))
    const j = await r.json(); return ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim()
  } catch (e) { if (e && (e.name === 'AbortError' || /abort/i.test(String(e && e.message)))) throw new Error('AI 整理超时，请稍后重试'); throw e } finally { clearTimeout(to) }
}
const SYS = '你是企业级 AI 情报分析助手。用中文、专业简洁、只依据给定原文整理，不编造。输出用轻量 Markdown。'

async function processUrl(url) {
  if (db.reports.some(r => r.url === url)) return db.reports.find(r => r.url === url)
  const res = await fetchUrl(url)
  if (!res.buf || res.status >= 400) throw new Error('抓取失败 HTTP ' + res.status)
  const html = res.buf.toString('utf8')
  const a = extractWechat(html)
  if (!a.body || a.body.length < 40) throw new Error('未提取到正文（可能需验证或非公众号文章页）')
  let output
  try { output = await ai(SYS, '这是公众号「' + (a.nickname || '静言波语') + '」发布的《企业级AI应用日报》原文（标题：' + a.title + '，发布于 ' + a.pub + '）。请整理成结构化日报，用 Markdown，结构：\n## 今日速览\n（3-5 句，点出当天最重要的 AI 应用动态）\n## 重点事件\n（分条，每条 **标题** — 一句话事件 + 一句话“值得关注的原因”，按重要度精选 8-12 条，兼顾国内/海外、模型/平台/行业落地）\n## 趋势与信号\n（2-4 条）\n## 对企业售前/投标的启发\n（2-4 条可执行建议）\n只依据原文，不编造，控制在 900 字内。\n\n=== 原文 ===\n' + a.body.slice(0, 12000), 1600) }
  catch (e) { output = '（AI 整理失败：' + e.message + '）\n\n原文摘要：' + a.body.slice(0, 500) }
  const date = (a.pub || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
  const rep = { id: uid('r'), url, title: a.title || '企业级AI应用日报', nickname: a.nickname || '', pub: a.pub || '', date, output, createdAt: Date.now() }
  db.reports.unshift(rep); prune(); save(); return rep
}
async function runFetch() { let added = 0; for (const l of db.links) { if (!db.reports.some(r => r.url === l.url)) { try { await processUrl(l.url); added++ } catch (e) { LOG('日报抓取失败 ' + l.url + '：' + e.message) } } } db.lastRun = Date.now(); save(); return { added, total: db.reports.length } }

let _running = false
async function dailyTick() { const now = new Date(Date.now() + 8 * 3600e3); if (now.getUTCHours() < 9) return; const day = now.toISOString().slice(0, 10); if (new Date(db.lastRun + 8 * 3600e3).toISOString().slice(0, 10) === day) return; if (_running) return; _running = true; try { LOG('AI应用日报：处理链接清单'); const r = await runFetch(); LOG('AI应用日报完成，新增 ' + r.added) } catch (e) { LOG('日报定时异常：' + e.message) } finally { _running = false } }
function startScheduler() { setInterval(() => { dailyTick().catch(() => {}) }, 30 * 60 * 1000); setTimeout(() => dailyTick().catch(() => {}), 12000) }

function send(res, code, obj) { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': b.length }); res.end(b) }
function readJson(req) { return new Promise((resolve, reject) => { let n = 0; const ch = []; req.on('data', c => { n += c.length; if (n > 2e6) { reject(new Error('过大')); req.destroy(); return } ch.push(c) }); req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(ch).toString('utf8') || '{}')) } catch (e) { reject(e) } }); req.on('error', reject) }) }

async function handle(req, res, p) {
  const method = req.method
  try {
    if (p === '/api/aidaily' && method === 'GET') return send(res, 200, { ok: true, links: db.links, reports: db.reports.slice(0, 200), stats: { total: db.reports.length, lastRun: db.lastRun } })
    if (p === '/api/aidaily/link' && method === 'POST') { const b = await readJson(req); const url = String(b.url || '').trim(); if (!/^https?:\/\/mp\.weixin\.qq\.com\//i.test(url)) return send(res, 400, { error: '请输入 mp.weixin.qq.com 公众号文章链接' }); if (!db.links.some(l => l.url === url)) { db.links.push({ id: uid('l'), url, addedAt: Date.now() }); save() } if (_running) return send(res, 200, { ok: true, queued: true }); _running = true; try { const rep = await processUrl(url); return send(res, 200, { ok: true, report: rep }) } finally { _running = false } }
    if (p.startsWith('/api/aidaily/link/') && method === 'DELETE') { const id = decodeURIComponent(p.slice('/api/aidaily/link/'.length)); db.links = db.links.filter(l => l.id !== id); save(); return send(res, 200, { ok: true }) }
    if (p === '/api/aidaily/fetch' && method === 'POST') { if (_running) return send(res, 409, { error: '处理中，请稍候' }); _running = true; try { const r = await runFetch(); return send(res, 200, { ok: true, ...r }) } finally { _running = false } }
    if (p.startsWith('/api/aidaily/report/') && method === 'DELETE') { const id = decodeURIComponent(p.slice('/api/aidaily/report/'.length)); db.reports = db.reports.filter(r => r.id !== id); save(); return send(res, 200, { ok: true }) }
    return send(res, 404, { error: 'no such aidaily api' })
  } catch (e) { LOG('aidaily 异常：' + (e && e.stack || e)); return send(res, 500, { error: String((e && e.message) || e) }) }
}
module.exports = { init, handle, startScheduler }
