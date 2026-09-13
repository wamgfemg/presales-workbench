/* ===== 销售培训：记录对销售的培训并做统计分析（依赖 main.js persist/toast/openMask/closeMask，auth.js canEdit/currentRole） ===== */
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] }) }
  function canEdit() { var r = window.currentRole && window.currentRole(); return r === 'admin' || (window.canEdit && window.canEdit('sales')) }
  var TYPES = ['产品知识', '解决方案', '销售技巧', '竞品分析', '流程制度', '行业/客户', '其他'];
  var FORMATS = ['线下集中', '线上直播', '线上会议', '一对一', '外训'];
  function rows() { return (store.salesTraining || []).slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') }) }
  function bar(obj) {
    var ks = Object.keys(obj).sort(function (a, b) { return obj[b] - obj[a] }); var mx = 1; ks.forEach(function (k) { if (obj[k] > mx) mx = obj[k] })
    return ks.length ? ks.map(function (k) { return '<div class="st-bar"><span class="st-bl" title="' + esc(k) + '">' + esc(k) + '</span><span class="st-bt"><i style="width:' + Math.round(obj[k] / mx * 100) + '%"></i></span><b>' + obj[k] + '</b></div>' }).join('') : '<div class="empty" style="padding:8px">暂无</div>'
  }
  window.renderSales = function () {
    var el = document.getElementById('salesBody'); if (!el) return
    var E = canEdit(); var r = rows()
    var total = r.length, people = r.reduce(function (s, x) { return s + (+x.count || 0) }, 0)
    var byType = {}, bySol = {}, byTrainer = {}, byMonth = {}
    r.forEach(function (x) { byType[x.type] = (byType[x.type] || 0) + 1; if (x.solution) bySol[x.solution] = (bySol[x.solution] || 0) + 1; if (x.trainer) byTrainer[x.trainer] = (byTrainer[x.trainer] || 0) + 1; var m = (x.date || '').slice(0, 7); if (m) byMonth[m] = (byMonth[m] || 0) + 1 })
    var toolbar = '<div class="mk-page-head"><div class="mk-stats">共 <b>' + total + '</b> 场培训 · 累计覆盖 <b>' + people + '</b> 人次</div><div class="mk-toolbar">' + (E ? '<button class="btn sm" onclick="openSales()">＋ 新增培训</button>' : '') + '</div></div>'
    var stats = '<div class="card"><h3>培训统计</h3><div class="grid g4" style="margin-bottom:14px">' +
      '<div class="st-kpi"><span>总场次</span><b>' + total + '</b></div><div class="st-kpi"><span>累计覆盖人次</span><b>' + people + '</b></div><div class="st-kpi"><span>涉及产品线</span><b>' + Object.keys(bySol).length + '</b></div><div class="st-kpi"><span>讲师数</span><b>' + Object.keys(byTrainer).length + '</b></div></div>' +
      '<div class="grid g2"><div><h4 style="margin:0 0 6px">按类型</h4>' + bar(byType) + '</div><div><h4 style="margin:0 0 6px">按产品线 / 方案</h4>' + bar(bySol) + '</div></div>' +
      '<div style="margin-top:12px"><h4 style="margin:0 0 6px">按月份趋势</h4>' + bar(byMonth) + '</div></div>'
    var table
    if (!r.length) table = '<div class="card"><div class="empty">还没有培训记录，点「＋ 新增培训」。</div></div>'
    else table = '<div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto"><table class="mk-reports"><tr><th>培训主题</th><th>类型</th><th>产品线/方案</th><th>讲师</th><th>日期</th><th class="num">时长</th><th class="num">人数</th><th>形式</th>' + (E ? '<th style="width:110px">操作</th>' : '') + '</tr>' +
      r.map(function (x) { return '<tr><td><b>' + esc(x.topic) + '</b>' + (x.feedback ? '<div class="st-fb">' + esc(String(x.feedback).slice(0, 40)) + '</div>' : '') + '</td><td>' + esc(x.type || '—') + '</td><td>' + esc(x.solution || '—') + '</td><td>' + esc(x.trainer || '—') + '</td><td>' + esc(x.date || '—') + '</td><td class="num">' + (x.hours || '—') + '</td><td class="num">' + (x.count || '—') + '</td><td>' + esc(x.format || '—') + '</td>' + (E ? '<td><button class="btn sm ghost" onclick="openSales(\'' + x.id + '\')">编辑</button> <button class="btn sm danger" onclick="delSales(\'' + x.id + '\')">删</button></td>' : '') + '</tr>' }).join('') + '</table></div></div>'
    el.innerHTML = toolbar + stats + table
  }
  window.openSales = function (id) {
    var r = id ? (store.salesTraining || []).find(function (x) { return x.id === id }) : null
    document.getElementById('salesModalTitle').textContent = r ? '编辑培训' : '新增培训'
    document.getElementById('saId').value = r ? r.id : ''
    var set = function (i, v) { var e = document.getElementById(i); if (e) e.value = v || '' }
    set('saTopic', r && r.topic); set('saTrainer', r && r.trainer); set('saDate', r && r.date); set('saHours', r && r.hours); set('saCount', r && r.count); set('saAtt', r && r.attendees); set('saFb', r && r.feedback); set('saNotes', r && r.notes); set('saSol', r && r.solution)
    document.getElementById('saType').innerHTML = TYPES.map(function (t) { return '<option' + (r && r.type === t ? ' selected' : '') + '>' + t + '</option>' }).join('')
    document.getElementById('saFormat').innerHTML = FORMATS.map(function (t) { return '<option' + (r && r.format === t ? ' selected' : '') + '>' + t + '</option>' }).join('')
    openMask('mSales')
  }
  window.saveSales = function () {
    var topic = document.getElementById('saTopic').value.trim(); if (!topic) { toast('请填写培训主题'); return }
    store.salesTraining = store.salesTraining || []
    var id = document.getElementById('saId').value
    var g = function (i) { var e = document.getElementById(i); return e ? e.value.trim() : '' }
    var data = { id: id || ('sa' + Date.now()), topic: topic, type: g('saType'), solution: g('saSol'), trainer: g('saTrainer'), date: g('saDate'), hours: g('saHours'), attendees: g('saAtt'), count: parseInt(g('saCount'), 10) || 0, format: g('saFormat'), feedback: g('saFb'), notes: g('saNotes'), createdAt: Date.now() }
    if (id) { var i = store.salesTraining.findIndex(function (x) { return x.id === id }); if (i > -1) { data.createdAt = store.salesTraining[i].createdAt || data.createdAt; store.salesTraining[i] = data } } else store.salesTraining.push(data)
    persist(); closeMask('mSales'); renderSales(); toast('已保存')
  }
  window.delSales = function (id) { if (!confirm('删除该培训记录？')) return; store.salesTraining = (store.salesTraining || []).filter(function (x) { return x.id !== id }); persist(); renderSales(); toast('已删除') }
})()
