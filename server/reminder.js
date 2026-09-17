'use strict'
/**
 * ③ 待办巡检（我的待办的服务端底座）
 *  - 每日扫描 SQLite「projects」集合里所有项目的 nextSteps，
 *    汇总逾期 / 临期 / 需升级（逾期≥3天），写入集合 reminder_state。
 *  - 前端「我的待办」为准实时计算；本模块提供服务端快照与手动触发，供后续接 IM/邮件通知。
 */
const DB = require('./db.js')

let _log = () => {}
function init(opts = {}) { _log = opts.log || (() => {}) }

function todayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

function scan() {
  const rec = DB.get('projects')
  const projects = (rec && rec.data && Array.isArray(rec.data)) ? rec.data : []
  const date = todayStr()
  const now = Date.now(), DAY = 86400000
  const byOwner = {}
  const escalation = []
  let totalOpen = 0, totalOver = 0, totalEsc = 0
  projects.forEach(function (p) {
    const steps = Array.isArray(p.nextSteps) ? p.nextSteps : []
    steps.forEach(function (s) {
      if (!s || s.done) return
      totalOpen++
      const due = s.due, over = !!due && new Date(due) < now
      let esc = false
      if (over) { totalOver++; const d = Math.floor((now - new Date(due)) / DAY); if (d >= 3) { esc = true; totalEsc++ } }
      const owner = (s.owner && String(s.owner).trim()) || '（未指定）'
      const o = byOwner[owner] || (byOwner[owner] = { open: 0, over: 0, esc: 0 })
      o.open++; if (over) o.over++; if (esc) o.esc++
      if (esc) escalation.push({ project: p.name || '', customer: p.customer || '', what: s.what || '', owner: s.owner || '', due: due })
    })
  })
  const summary = { date, totalOpen, totalOver, totalEsc, byOwner, escalation }
  try { DB.put('reminder_state', summary, { force: true }) } catch (e) { _log('reminder put failed: ' + (e && e.message)) }
  return summary
}

function startScheduler() {
  const tick = () => { try { const s = scan(); _log('reminder: 逾期' + s.totalOver + ' 升级' + s.totalEsc + ' 待办' + s.totalOpen) } catch (e) { _log('reminder scan error: ' + (e && e.message)) } }
  setTimeout(tick, 6000)
  setInterval(tick, 6 * 60 * 60 * 1000) // 6 小时巡检一次，幂等
}

function send(res, code, obj) { try { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) } catch (_) {} }

function handle(req, res, ap) {
  if (req.method === 'GET' && (ap === '/api/reminder/scan' || ap === '/api/reminder')) {
    try { send(res, 200, { ok: true, data: scan() }) } catch (e) { send(res, 500, { ok: false, error: (e && e.message) || '扫描失败' }) }
    return
  }
  if (req.method === 'GET' && ap === '/api/reminder/state') {
    const rec = DB.get('reminder_state'); send(res, 200, { ok: true, data: rec ? rec.data : null }); return
  }
  send(res, 404, { ok: false, error: 'not found' })
}

module.exports = { init, startScheduler, handle, scan }