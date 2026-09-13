/* ===== 市场情报前端：报告清单台账 + 报告详情 + 来源/录入/生成弹窗（依赖 main.js toast/openMask/closeMask，auth.js canEdit/currentRole） ===== */
(function () {
  var MKT = { sources: [], items: [], briefs: [], stats: {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] }) }
  function canEditMarket() { var r = window.currentRole && window.currentRole(); return r === 'admin' || (window.canEdit && window.canEdit('market')) }
  function api(url, opts) { return fetch(url, Object.assign({ headers: { 'content-type': 'application/json' } }, opts || {})).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j } }).catch(function () { return { status: r.status, body: {} } }) }) }
  function dayStr(ts) { return new Date((ts || 0) + 8 * 3600e3).toISOString().slice(0, 10) }
  function dt(ts) { return new Date(ts).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-') }
  function refreshMkt() { return api('/api/market').then(function (r) { if (r.status === 200) MKT = r.body; return r }) }

  /* ---- 轻量 Markdown（含表格/标题/列表/链接） ---- */
  function inline(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>') }
  function mkTable(head, rows) {
    function cells(l) { return l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim() }) }
    var h = '<table class="mk-table"><thead><tr>' + cells(head).map(function (c) { return '<th>' + inline(c) + '</th>' }).join('') + '</tr></thead><tbody>'
    for (var i = 0; i < rows.length; i++) h += '<tr>' + cells(rows[i]).map(function (c) { return '<td>' + inline(c) + '</td>' }).join('') + '</tr>'
    return h + '</tbody></table>'
  }
  function mkMd(src) {
    var lines = String(src || '').split(/\r?\n/), html = '', para = [], inCode = false
    function flush() { if (para.length) { html += '<p>' + inline(para.join(' ')) + '</p>'; para = [] } }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i]
      if (/^\s*```/.test(ln)) { if (inCode) { html += '</pre>'; inCode = false } else { flush(); html += '<pre>'; inCode = true } continue }
      if (inCode) { html += esc(ln) + '\n'; continue }
      if (/^\s*$/.test(ln)) { flush(); continue }
      if (ln.indexOf('|') >= 0 && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
        flush(); var rows = []; var j = i + 2
        while (j < lines.length && lines[j].indexOf('|') >= 0 && lines[j].trim()) { rows.push(lines[j]); j++ }
        html += mkTable(ln, rows); i = j - 1; continue
      }
      var hm = /^(#{1,4})\s+(.*)$/.exec(ln); if (hm) { flush(); var lv = hm[1].length; html += '<h' + lv + '>' + inline(hm[2]) + '</h' + lv + '>'; continue }
      var lm = /^\s*[-*·]\s+(.*)$/.exec(ln); if (lm) { flush(); html += '<div class="mk-li">· ' + inline(lm[1]) + '</div>'; continue }
      para.push(ln.trim())
    }
    if (inCode) html += '</pre>'; flush(); return html
  }

  /* ================= 市场情报：报告清单 ================= */
  var MK_PAGE = 0
  function mkReports() { return (MKT.briefs || []).filter(function (b) { return b.type !== 'digest' }).slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0) }) }
  function mkFeatCard(b) {
    var tag = b.type === 'compare' ? '<span class="mk-badge mk-badge-c">运维厂商/平台对比</span>' : '<span class="mk-badge mk-badge-b">IT运维市场简报</span>'
    var prev = String(b.output || '').replace(/[#*>|`-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)
    return '<div class="mk-feat" onclick="viewReport(\'' + b.id + '\')">' + tag + '<div class="mk-feat-t">' + esc(b.title) + '</div><div class="mk-feat-p">' + esc(prev) + '…</div><div class="mk-feat-m">' + dt(b.createdAt) + (b.refs && b.refs.length ? ' · 基于 ' + b.refs.length + ' 条素材' : '') + '</div></div>'
  }
  function mkItemRow(it) {
    return '<div class="mk-item"><div class="mk-item-h">' + (it.url ? '<a href="' + esc(it.url) + '" target="_blank">' + esc(it.title) + '</a>' : esc(it.title)) + '</div>' +
      '<div class="mk-item-m"><span class="tag">' + esc(it.sourceName || '') + '</span> ' + esc(it.published || dayStr(it.fetchedAt)) + (canEditMarket() ? ' <button class="btn sm ghost" style="float:right;padding:2px 8px" onclick="mkDelItem(\'' + it.id + '\')">删除</button>' : '') + '</div>' +
      (it.summary ? '<div class="mk-item-s">' + esc(it.summary) + '</div>' : '') + '</div>'
  }
  function renderMkHist(reports) {
    var box = document.getElementById('mkHist'); if (!box) return
    reports = reports || mkReports()
    var PS = 8, pages = Math.max(1, Math.ceil(reports.length / PS)); if (MK_PAGE >= pages) MK_PAGE = pages - 1; if (MK_PAGE < 0) MK_PAGE = 0
    var slice = reports.slice(MK_PAGE * PS, MK_PAGE * PS + PS)
    var rows = slice.map(function (b) { return '<tr class="mk-row" onclick="viewReport(\'' + b.id + '\')"><td class="mk-rt-title"><b>' + esc(b.title) + '</b></td><td>' + (b.type === 'compare' ? '<span class="mk-badge mk-badge-c">对比</span>' : '<span class="mk-badge mk-badge-b">简报</span>') + '</td><td class="mk-rt-time">' + dt(b.createdAt) + '</td><td>' + (canEditMarket() ? '<button class="btn sm ghost" onclick="event.stopPropagation();mkDelBrief(\'' + b.id + '\')">删除</button>' : '') + '</td></tr>' }).join('')
    box.innerHTML = '<div style="overflow-x:auto"><table class="mk-reports"><tr><th>报告</th><th style="width:88px">类型</th><th style="width:150px">时间</th><th style="width:64px">操作</th></tr>' + (rows || '<tr><td colspan="4" class="empty">暂无历史报告</td></tr>') + '</table></div>'
      + '<div class="mk-pager"><button class="btn sm ghost" onclick="mkGoPage(-1)"' + (MK_PAGE <= 0 ? ' disabled' : '') + '>‹ 上一页</button><span>第 ' + (MK_PAGE + 1) + ' / ' + pages + ' 页 · 共 ' + reports.length + ' 份</span><button class="btn sm ghost" onclick="mkGoPage(1)"' + (MK_PAGE >= pages - 1 ? ' disabled' : '') + '>下一页 ›</button></div>'
  }
  window.mkGoPage = function (d) { var reports = mkReports(); var PS = 8, pages = Math.max(1, Math.ceil(reports.length / PS)); MK_PAGE = Math.min(pages - 1, Math.max(0, MK_PAGE + d)); renderMkHist(reports) }

  window.renderMarket = function () {
    var el = document.getElementById('marketBody'); if (!el) return
    api('/api/market').then(function (r) {
      if (r.status !== 200) { el.innerHTML = '<div class="card"><div class="empty">加载失败或无权限</div></div>'; return }
      MKT = r.body; var E = canEditMarket(); var st = MKT.stats || {}
      var toolbar = '<div class="mk-toolbar">' + (E ? '<button class="btn sm" id="mkFetchBtn" onclick="mkFetchNow()">⟳ 立即抓取</button><button class="btn sm" id="mkOpsBtn" onclick="mkOpsNews(this)">🌐 联网检索</button><button class="btn sm" onclick="openMkGen()">＋ 生成报告</button><button class="btn sm ghost" onclick="openMkImport()">📥 录入资料</button>' : '') + '<button class="btn sm ghost" onclick="openMkSources()">🔗 资讯来源</button></div>'
      var reports = mkReports()
      var head = '<div class="mk-page-head"><div class="mk-stats">共 <b>' + (MKT.items || []).length + '</b> 条 IT运维资讯 · ' + reports.length + ' 份报告 · 上次抓取 ' + (st.lastRun ? dt(st.lastRun) : '从未') + '</div>' + toolbar + '</div>'
      var featHtml = '<div class="card"><div class="cmp-head"><h3 style="margin:0">📊 最新报告</h3></div>' + (reports.slice(0, 3).map(mkFeatCard).join('') || '<div class="empty">还没有报告，点右上「＋ 生成报告」生成 IT运维市场简报 / 运维厂商对比。</div>') + '</div>'
      var itemsHtml = '<div class="card"><div class="cmp-head"><h3 style="margin:0">📡 最新抓取资讯（IT运维）</h3><span class="tag">' + (MKT.items || []).length + ' 条</span></div>' + ((MKT.items || []).slice(0, 15).map(mkItemRow).join('') || '<div class="empty">暂无资讯，点「⟳ 立即抓取」。</div>') + '</div>'
      var histHtml = '<div class="card"><div class="cmp-head"><h3 style="margin:0">🗂 历史报告</h3></div><div id="mkHist"></div></div>'
      el.innerHTML = head + featHtml + itemsHtml + histHtml
      renderMkHist(reports)
    })
  }
  /* ---- 报告详情 ---- */
  window.viewReport = function (id) {
    var b = (MKT.briefs || []).find(function (x) { return x.id === id }); if (!b) return
    document.getElementById('mkViewTitle').textContent = b.type === 'compare' ? '竞品对比报告' : '行业简报'
    var refs = (b.refs && b.refs.length) ? ('<span>基于 ' + b.refs.length + ' 条素材</span>') : ''
    document.getElementById('mkViewBody').innerHTML = '<div class="mk-report">'
      + '<div class="mk-report-head"><span class="mk-report-kicker">' + (b.type === 'compare' ? '竞品对比分析' : '行业 · 政策简报') + '</span><h2>' + esc(b.title) + '</h2>'
      + '<div class="mk-report-meta"><span>' + dt(b.createdAt) + '</span>' + refs + '<span>AI 整理，供参考</span></div></div>'
      + '<div class="mk-report-body">' + mkMd(b.output) + '</div></div>'
    openMask('mMkView')
  }

  /* ---- 抓取 ---- */
  window.mkFetchNow = function () { var b = document.getElementById('mkFetchBtn'); if (b) { b.disabled = true; b.textContent = '抓取中…' } api('/api/market/fetch', { method: 'POST', body: '{}' }).then(function (r) { if (b) { b.disabled = false; b.textContent = '⟳ 立即抓取' } if (r.status === 200) { toast('抓取完成，新增 ' + (r.body.added || 0) + ' 条'); renderMarket() } else toast((r.body && r.body.error) || '抓取失败') }).catch(function () { if (b) { b.disabled = false; b.textContent = '⟳ 立即抓取' } toast('抓取失败') }) }

  window.mkOpsNews=function(btn){ if(btn){btn.disabled=true;btn.textContent='检索中…'} toast('联网检索 IT运维动态中，约需 1 分钟…'); api('/api/market/ops-news',{method:'POST',body:'{}'}).then(function(r){ if(btn){btn.disabled=false;btn.textContent='🌐 联网检索'} if(r.status===200){toast('检索完成，新增 '+(r.body.added||0)+' 条');renderMarket()} else toast((r.body&&r.body.error)||'检索失败') }).catch(function(){ if(btn){btn.disabled=false;btn.textContent='🌐 联网检索'} toast('检索失败') }) }
  /* ---- 资讯来源（弹窗） ---- */
  function renderSourcesModal() {
    var rows = (MKT.sources || []).map(function (s) {
      return '<tr><td>' + esc(s.name) + '</td><td class="mk-url">' + esc(s.url) + '</td><td>' + (s.active === false ? '<span class="tag">停用</span>' : '<span class="tag" style="background:#e6f4ea;color:#2f9e44">启用</span>') + '</td>'
        + '<td style="white-space:nowrap"><button class="btn sm ghost" onclick="mkToggleSource(\'' + s.id + '\',' + (s.active === false) + ')">' + (s.active === false ? '启用' : '停用') + '</button> <button class="btn sm danger" onclick="mkDelSource(\'' + s.id + '\')">删除</button></td></tr>'
    }).join('')
    document.getElementById('mkSrcBody').innerHTML = '<div style="overflow-x:auto"><table><tr><th>名称</th><th>源地址</th><th>状态</th><th style="width:150px">操作</th></tr>' + (rows || '<tr><td colspan="4" class="empty">暂无来源</td></tr>') + '</table></div>'
      + '<div class="mk-src-add"><input id="msName" placeholder="来源名称"><input id="msUrl" placeholder="RSS/Atom 地址 https://…"><button class="btn sm" onclick="addMkSource()">＋ 添加</button></div>'
      + '<div class="hint" style="margin-top:10px">政府政策类站点多无规范 RSS、易被反爬，建议用「录入资料」粘贴 URL 或原文补录。每日 08:00 自动抓取启用中的源。</div>'
  }
  window.openMkSources = function () { refreshMkt().then(renderSourcesModal); openMask('mMkSources') }
  window.addMkSource = function () { var name = document.getElementById('msName').value.trim(), url = document.getElementById('msUrl').value.trim(); if (!url) { toast('请输入源地址'); return } api('/api/market/source', { method: 'POST', body: JSON.stringify({ name: name, url: url }) }).then(function (r) { if (r.status === 200) { toast('已添加'); refreshMkt().then(renderSourcesModal) } else toast((r.body && r.body.error) || '失败') }) }
  window.mkToggleSource = function (id, active) { api('/api/market/source/' + id, { method: 'PUT', body: JSON.stringify({ active: !!active }) }).then(function () { refreshMkt().then(renderSourcesModal) }) }
  window.mkDelSource = function (id) { if (!confirm('删除该来源？')) return; api('/api/market/source/' + id, { method: 'DELETE' }).then(function () { refreshMkt().then(renderSourcesModal) }) }

  /* ---- 录入资料（弹窗） ---- */
  window.openMkImport = function () { ['mkImpUrl', 'mkImpTitle', 'mkImpText'].forEach(function (i) { var e = document.getElementById(i); if (e) e.value = '' }); openMask('mMkImport') }
  window.mkImportUrl = function () { var u = document.getElementById('mkImpUrl').value.trim(); if (!u) { toast('请输入 URL'); return } toast('抓取中…'); api('/api/market/import', { method: 'POST', body: JSON.stringify({ url: u }) }).then(function (r) { if (r.status === 200) { toast('已提炼归档'); closeMask('mMkImport'); renderMarket() } else toast((r.body && r.body.error) || '失败') }) }
  window.mkImportText = function () { var t = document.getElementById('mkImpText').value.trim(); if (!t) { toast('请粘贴原文'); return } toast('提炼中…'); api('/api/market/import', { method: 'POST', body: JSON.stringify({ title: document.getElementById('mkImpTitle').value.trim(), text: t }) }).then(function (r) { if (r.status === 200) { toast('已提炼归档'); closeMask('mMkImport'); renderMarket() } else toast((r.body && r.body.error) || '失败') }) }

  /* ---- 生成报告（弹窗） ---- */
  window.openMkGen = function () {
    var recent = (MKT.items || []).slice(0, 30).map(function (it) { return '<label class="mk-pick"><input type="checkbox" value="' + it.id + '"> <b>' + esc(it.title) + '</b><span class="mk-pick-meta">' + esc(it.sourceName) + ' · ' + (it.published || dayStr(it.fetchedAt)) + '</span></label>' }).join('')
    document.getElementById('mkGenPicks').innerHTML = recent || '<div class="empty" style="padding:10px">暂无资讯条目，可只在下方粘贴素材生成</div>'
    document.getElementById('mkGenText').value = ''; document.getElementById('mkGenTitle').value = ''; document.getElementById('mkGenErr').textContent = ''
    openMask('mMkGen')
  }
  window.submitMkGen = function (type) {
    var ids = [].slice.call(document.querySelectorAll('#mkGenPicks input:checked')).map(function (x) { return x.value })
    var extra = (document.getElementById('mkGenText').value || '').trim(), title = document.getElementById('mkGenTitle').value.trim(), err = document.getElementById('mkGenErr'); err.textContent = ''
    if (!ids.length && !extra) { err.textContent = '请勾选条目或粘贴补充素材'; return }
    var btns = document.querySelectorAll('#mMkGen button'); btns.forEach(function (b) { b.disabled = true }); toast('AI 整理中，约需 1 分钟…')
    api('/api/market/organize', { method: 'POST', body: JSON.stringify({ type: type, itemIds: ids, text: extra, title: title }) }).then(function (r) { btns.forEach(function (b) { b.disabled = false }); if (r.status === 200) { closeMask('mMkGen'); toast('报告已生成'); renderMarket() } else err.textContent = (r.body && r.body.error) || '整理失败' }).catch(function () { btns.forEach(function (b) { b.disabled = false }); err.textContent = '整理失败' })
  }
  window.mkDelBrief = function (id) { if (!confirm('删除该报告？')) return; api('/api/market/brief/' + id, { method: 'DELETE' }).then(function () { renderMarket() }) }

  /* ================= 竞品图谱（存库：store.competitors → SQLite /api/state） ================= */
  var CMP_CATS={apm:'IT运维监控 / APM',dcim:'DCIM / 机房动环',bi:'BI / 数据分析',cloud:'云原生 / 超融合',svc:'IT服务 / 运维原厂与第三方'};
  var CMP_SEED={vendors:[
    {name:'听云（基调听云）',category:'apm',aliases:'基调网络;TingYun',description:'北京基调网络股份有限公司，应用性能管理（APM）与用户体验监控。'},
    {name:'云智慧',category:'apm',aliases:'Cloudwise',description:'AIOps 智能运维、监控与 ITSM 平台；2021 年全资并购卓益达。'},
    {name:'博睿数据',category:'apm',aliases:'Bonree;北京博睿宏远数据科技',description:'北京博睿宏远数据科技股份有限公司，APM 与数字体验监测。'},
    {name:'日志易',category:'apm',aliases:'北京优特捷',description:'北京优特捷信息技术有限公司，日志大数据分析平台。'},
    {name:'彩讯科技（RichAPM）',category:'apm',aliases:'RichAPM',description:'服务器/移动应用/网络流量/应用程序/网站/邮箱质量/中间件 七大监控产品，已实现平台一体化集中监控。'},
    {name:'新炬网络',category:'apm',aliases:'SIOPS;新炬',description:'自研 SIOPS 智慧运维、APM、DPM 数据库性能、SQL 审核、IVORY 日志分析、DAMS 数据资产、GDEVOPS 敏捷交付等产品矩阵。'},
    {name:'嘉为蓝鲸 / 嘉为科技',category:'apm',aliases:'蓝鲸;腾讯蓝鲸智云',description:'腾讯蓝鲸智云全国首家授权技术合作伙伴，拥有 IT 自动化运维、IT 基础架构服务、应用软件开发、云计算四大业务系列。'},
    {name:'网强',category:'apm',aliases:'',description:'网络管理与运维监控厂商。'},
    {name:'擎创科技',category:'apm',aliases:'',description:'AIOps 智能运维。'},
    {name:'科来',category:'apm',aliases:'Colasoft',description:'网络性能管理与流量分析。'},
    {name:'天旦',category:'apm',aliases:'上海天旦网络',description:'上海天旦网络科技（2005 年成立），业务与网络性能管理，聚焦关键业务保障、交易分析、大数据采集挖掘。'},
    {name:'OneAPM（蓝海讯通）',category:'apm',aliases:'北京蓝海讯通',description:'北京蓝海讯通科技股份有限公司，端到端 APM 应用性能管理与监控解决方案。'},
    {name:'广通信达',category:'apm',aliases:'',description:'在数据中心、互联网、物联网三大领域提供敏捷运维工具与服务。'},
    {name:'中亦科技',category:'apm',aliases:'',description:'IT 运维服务与监控。'},
    {name:'神州泰岳',category:'apm',aliases:'',description:'统一运维管理（入选统一运维软件 TOP10）。'},
    {name:'新华三 U-Center',category:'apm',aliases:'H3C;新华三',description:'U-Center 统一运维平台（统一运维软件 TOP10）。'},
    {name:'微福思',category:'apm',aliases:'',description:'统一运维软件 TOP10 厂商。'},
    {name:'SolarWinds',category:'apm',aliases:'',description:'国际 IT 运维监控厂商（统一运维 TOP10）。'},
    {name:'IBM',category:'apm',aliases:'',description:'ITOM / 运维管理（统一运维 TOP10）。'},
    {name:'爱狄特',category:'apm',aliases:'ADT',description:'IT 运维管理领域厂商。'},
    {name:'摩卡',category:'apm',aliases:'摩卡软件',description:'IT 运维管理领域厂商。'},
    {name:'广州轻维',category:'apm',aliases:'',description:'IT 运维管理领域厂商。'},
    {name:'华青融天',category:'apm',aliases:'',description:'IT 运维管理领域厂商。'},
    {name:'百泉众合',category:'apm',aliases:'',description:'IT 运维管理领域厂商。'},
    {name:'久其智通',category:'apm',aliases:'',description:'IT 运维管理领域厂商。'},
    {name:'北塔',category:'apm',aliases:'',description:'IT 运维管理领域厂商。'},
    {name:'大讯永新',category:'apm',aliases:'',description:'IT 运维管理领域厂商。'},
    {name:'思福迪',category:'apm',aliases:'',description:'IT 运维管理领域厂商（日志/安全）。'},
    {name:'台湾精诚',category:'apm',aliases:'',description:'IT 运维管理领域厂商。'},
    {name:'华夏威科',category:'apm',aliases:'',description:'IT 运维管理领域厂商。'},
    {name:'北明',category:'apm',aliases:'',description:'IT 运维管理领域厂商。'},
    {name:'共济科技',category:'dcim',aliases:'共济',description:'机房动环监控 / DCIM。'},
    {name:'维谛 Vertiv',category:'dcim',aliases:'艾默生网络能源',description:'数据中心基础设施与动环。'},
    {name:'施耐德电气',category:'dcim',aliases:'Schneider;EcoStruxure',description:'数据中心基础设施管理 DCIM。'},
    {name:'华为（DCIM）',category:'dcim',aliases:'',description:'数据中心基础设施与智能运维。'},
    {name:'金鹏正',category:'dcim',aliases:'',description:'机房动环监控厂商。'},
    {name:'卓益达',category:'dcim',aliases:'',description:'动环监控厂商，2021 年被云智慧全资并购。'},
    {name:'龙控',category:'dcim',aliases:'',description:'机房动环监控厂商。'},
    {name:'博创',category:'dcim',aliases:'',description:'机房动环监控厂商。'},
    {name:'中兴力维',category:'dcim',aliases:'',description:'机房动力环境监控。'},
    {name:'ABB',category:'dcim',aliases:'',description:'数据中心配电与基础设施。'},
    {name:'天河（天河电子）',category:'dcim',aliases:'',description:'机房动环监控厂商。'},
    {name:'深圳计通智能',category:'dcim',aliases:'计通',description:'机房动环 / 智慧机房。'},
    {name:'吉黄',category:'dcim',aliases:'',description:'机房动环监控厂商。'},
    {name:'格栅',category:'dcim',aliases:'',description:'机房动环监控厂商。'},
    {name:'CA',category:'dcim',aliases:'',description:'运维监控厂商。'},
    {name:'东软',category:'dcim',aliases:'Neusoft',description:'IT 解决方案与运维。'},
    {name:'派诺',category:'dcim',aliases:'',description:'电力/动环监控。'},
    {name:'西门子',category:'dcim',aliases:'Siemens',description:'数据中心基础设施。'},
    {name:'康普',category:'dcim',aliases:'CommScope',description:'数据中心物理基础设施/布线。'},
    {name:'浪潮',category:'dcim',aliases:'Inspur',description:'数据中心基础设施与算力。'},
    {name:'英维克',category:'dcim',aliases:'Envicool',description:'数据中心温控/精密制冷。'},
    {name:'亿信华辰',category:'bi',aliases:'',description:'BI 与数据分析。'},
    {name:'永洪科技',category:'bi',aliases:'Yonghong',description:'BI 与大数据分析。'},
    {name:'帆软',category:'bi',aliases:'FineReport;FineBI',description:'报表与 BI 龙头。'},
    {name:'SmartBI',category:'bi',aliases:'思迈特',description:'BI 与数据分析。'},
    {name:'灵雀云',category:'cloud',aliases:'Alauda',description:'容器云 / 云原生平台。'},
    {name:'博云',category:'cloud',aliases:'BoCloud',description:'云原生 / 超融合与运维。'},
    {name:'联想',category:'svc',aliases:'Lenovo',description:'IT 运维原厂服务商之一。'},
    {name:'软通动力',category:'svc',aliases:'iSoftStone',description:'IT 服务外包与运维。'},
    {name:'神州数码',category:'svc',aliases:'',description:'IT 分销与服务。'},
    {name:'亚信科技',category:'svc',aliases:'AsiaInfo',description:'电信软件与运维。'},
    {name:'东华软件',category:'svc',aliases:'东华',description:'系统集成与运维服务。'},
    {name:'浙大网新',category:'svc',aliases:'',description:'IT 服务与运维。'},
    {name:'银信科技',category:'svc',aliases:'',description:'第三方 IT 运维服务代表厂商。'},
    {name:'海量数据',category:'svc',aliases:'',description:'数据库与第三方运维服务。'},
    {name:'天玑科技',category:'svc',aliases:'',description:'第三方 IT 运维服务代表厂商。'}
  ],facts:[
    {id:'f_seed1',vendor:'云智慧',category:'apm',date:'2021-06-01',title:'云智慧全资并购卓益达',summary:'云智慧完成对动环监控厂商卓益达的全资并购，补齐 DCIM / 机房动环能力，向一体化智能运维平台延伸。',source:'公开资料'},
    {id:'f_seed2',vendor:'行业格局',category:'apm',date:'2026-09-12',title:'统一运维软件市场 TOP10',summary:'统一运维软件 TOP10：新华三（U-Center）、华为、IBM、SolarWinds、博睿、科来、云智慧、神州泰岳、微福思、听云。',source:'行业榜单'},
    {id:'f_seed3',vendor:'行业格局',category:'svc',date:'2026-09-12',title:'国内 IT 运维管理原厂市场占比约 35%',summary:'国内 IT 运维管理原厂服务商市场占比约 35%，大型代表厂商有华为、联想等；专业第三方运维服务商包括天玑科技、银信科技、海量数据、新炬网络等。',source:'行业研究'},
    {id:'f_seed4',vendor:'嘉为蓝鲸',category:'apm',date:'2026-09-12',title:'嘉为蓝鲸四大业务系列',summary:'嘉为蓝鲸为腾讯蓝鲸智云全国首家授权技术合作伙伴，拥有 IT 自动化运维、IT 基础架构服务、应用软件开发、云计算四大系列。',source:'厂商资料'},
    {id:'f_seed5',vendor:'彩讯科技',category:'apm',date:'2026-09-12',title:'RichAPM 七大监控平台一体化',summary:'彩讯 RichAPM 已推出服务器/移动应用/网络流量/应用程序/网站/邮箱质量/中间件 七大监控产品，实现平台一体化集中监控。',source:'厂商资料'},
    {id:'f_seed6',vendor:'新炬网络',category:'apm',date:'2026-09-12',title:'新炬运维产品矩阵',summary:'新炬网络自研 SIOPS 智慧运维、APM、DPM 数据库性能、SQL 审核、IVORY 日志分析、DAMS 数据资产、GDEVOPS 敏捷交付等平台。',source:'厂商资料'}
  ]};
  var CMP_STATE={q:'',cat:''};
  function ensureCompetitors(){ if(!store.competitors||!store.competitors.vendors||!store.competitors.vendors.length){ store.competitors=JSON.parse(JSON.stringify(CMP_SEED)); try{persist()}catch(e){} } var vv=(store.competitors&&store.competitors.vendors)||[]; for(var i=0;i<vv.length;i++){ if(!vv[i].id)vv[i].id='v'+(i+1); if(!vv[i].dynamics)vv[i].dynamics=[] } }
  function cmpVendorCard(v){ var ds=(v.dynamics||[]).slice().sort(function(a,b){return (b.date||'').localeCompare(a.date||'')}); var n=ds.length; var top=ds.slice(0,3).map(function(d){return '<div class="vc-n"><span class="vc-nd">'+esc(d.date||'')+'</span>'+esc((d.title||d.summary||'').slice(0,30))+'</div>'}).join(''); var news=top?'<div class="vc-news">'+top+'</div>':''; return '<div class="vcard vcard-click" onclick="openVendor(\''+v.id+'\')"><div class="vn">'+esc(v.name)+' <span class="tag cat">'+esc(CMP_CATS[v.category]||v.category)+'</span></div>'+(v.aliases?'<div class="va">别名：'+esc(v.aliases)+'</div>':'')+'<div class="vd">'+esc(v.description||'')+'</div>'+news+'<div class="vc-foot"><span class="tag'+(n?' vc-hot':'')+'">动态 '+n+' 条</span>'+(canEditMarket()?'<span class="vc-acts"><button class="btn sm ghost" onclick="event.stopPropagation();fetchVendor(\''+v.id+'\')">⟳抓取</button> <button class="btn sm ghost" onclick="event.stopPropagation();openAddDyn(\''+v.id+'\')">＋录入</button></span>':'')+'</div></div>' }
  function renderCmpBlock(){
    var box=document.getElementById('cmpBlock'); if(!box)return
    var vs=(store.competitors&&store.competitors.vendors)||[]
    var q=CMP_STATE.q.toLowerCase(), cf=CMP_STATE.cat
    var list=vs.filter(function(v){ if(cf&&v.category!==cf)return false; if(q){var hay=(v.name+' '+(v.aliases||'')+' '+(v.description||'')).toLowerCase(); if(hay.indexOf(q)<0)return false} return true })
    var chips='<span class="cmp-chip'+(cf===''?' on':'')+'" onclick="cmpFilter(\'\')">全部</span>'+Object.keys(CMP_CATS).map(function(k){return '<span class="cmp-chip'+(cf===k?' on':'')+'" onclick="cmpFilter(\''+k+'\')">'+CMP_CATS[k]+'</span>'}).join('')
    var bycat={}; list.forEach(function(v){(bycat[v.category]=bycat[v.category]||[]).push(v)})
    var groups=''; Object.keys(CMP_CATS).forEach(function(c){ if(!bycat[c])return; groups+='<div class="cmp-cat"><div class="cmp-cath"><b>'+CMP_CATS[c]+'</b><span class="tag">'+bycat[c].length+'</span></div><div class="cmp-grid">'+bycat[c].map(cmpVendorCard).join('')+'</div></div>' })
    box.innerHTML='<div class="card"><div class="cmp-head"><h3 style="margin:0">🧭 竞品图谱</h3><span class="tag">共 '+list.length+' 家</span></div>'
      +'<div class="cmp-tools"><input type="text" placeholder="搜索厂商 / 别名 / 描述…" value="'+esc(CMP_STATE.q)+'" oninput="cmpSearch(this.value)"></div>'
      +'<div class="cmp-chips">'+chips+'</div>'+(groups||'<div class="empty">没有匹配的厂商</div>')+'</div>'
  }
  var CURVENDOR=null
  function findVendor(id){return (store.competitors&&store.competitors.vendors||[]).find(function(v){return v.id===id})}
  function renderVendorBody(v){
    var E=canEditMarket()
    var list=(v.dynamics||[]).slice().sort(function(a,b){return (b.date||'').localeCompare(a.date||'')})
    var items=list.length?list.map(function(d){ return '<div class="mk-item"><div class="mk-item-h">'+(d.url?'<a href="'+esc(d.url)+'" target="_blank">'+esc(d.title)+'</a>':esc(d.title))+(E?' <button class="btn sm ghost" style="float:right;padding:2px 8px" onclick="delVendorDyn(\''+d.id+'\')">删</button>':'')+'</div><div class="mk-item-m">'+(d.source?'<span class="tag">'+esc(d.source)+'</span> ':'')+(d.date?'<span>'+esc(d.date)+'</span>':'')+'</div>'+(d.summary?'<div class="mk-item-s">'+esc(d.summary)+'</div>':'')+'</div>' }).join('') : '<div class="empty">暂无该厂商动态。点「⟳ 抓取动态」从已抓取的资讯中匹配，或「＋ 录入动态」手动添加。</div>'
    document.getElementById('vendorViewBody').innerHTML='<div class="vv-head"><span class="tag cat">'+esc(CMP_CATS[v.category]||v.category)+'</span>'+(v.aliases?'<span class="vv-al">别名：'+esc(v.aliases)+'</span>':'')+'</div>'+(v.description?'<div class="vv-desc">'+esc(v.description)+'</div>':'')
      +'<div class="vv-acts">'+(E?'<button class="btn sm" onclick="fetchVendor(\''+v.id+'\')">⟳ 抓取动态</button><button class="btn sm ghost" onclick="openAddDyn(\''+v.id+'\')">＋ 录入动态</button><button class="btn sm danger" onclick="delVendor(\''+v.id+'\')">删除厂商</button>':'')+'</div>'
      +'<div class="vv-hist"><b>历史抓取明细</b><span class="tag">'+list.length+' 条</span>'+(v.lastFetch?' <span class="vv-lf">上次抓取 '+dt(v.lastFetch)+'</span>':'')+'</div>'+items
  }
  window.openVendor=function(id){ var v=findVendor(id); if(!v)return; CURVENDOR=id; document.getElementById('vendorViewTitle').textContent=v.name; renderVendorBody(v); openMask('mVendorView') }
  async function scanPools(v){ var names=[v.name].concat(String(v.aliases||'').split(/[;；,，]/).map(function(s){return s.trim()}).filter(Boolean)); var pools=[];
    function add(items,map){ (items||[]).forEach(function(i){ pools.push(map(i)) }) }
    try{var m=await api('/api/market'); if(m.status===200)add(m.body.items,function(i){return {title:i.title,url:i.url,summary:i.summary,date:i.published||dayStr(i.fetchedAt),source:i.sourceName}})}catch(e){}
    try{var s=await api('/api/scenario'); if(s.status===200)add(s.body.items,function(i){return {title:i.title,url:i.url,summary:i.summary,date:i.published||dayStr(i.fetchedAt),source:i.sourceName}})}catch(e){}
    try{var a=await api('/api/aidaily'); if(a.status===200)add(a.body.reports,function(i){return {title:i.title,url:i.url,summary:'',date:i.date||'',source:'AI应用日报'}})}catch(e){}
    return pools.filter(function(p){var hay=((p.title||'')+' '+(p.summary||'')).toLowerCase(); return names.some(function(n){return n&&hay.indexOf(n.toLowerCase())>=0})})
  }
  window.fetchVendor=function(id){ var v=findVendor(id); if(!v)return; toast('AI 生成 + 匹配厂商动态中…'); Promise.all([ api('/api/market/vendor-news',{method:'POST',body:JSON.stringify({vendor:v.name,aliases:v.aliases,description:v.description})}).then(function(r){return (r.status===200&&r.body.items)?r.body.items:[]}).catch(function(){return []}), scanPools(v).catch(function(){return []}) ]).then(function(a){ var llm=a[0],pool=a[1],haveT={},haveU={}; v.dynamics=v.dynamics||[]; v.dynamics.forEach(function(d){if(d.title)haveT[d.title]=1;if(d.url)haveU[d.url]=1}); var added=0; function push(h,src){ if(h.title&&haveT[h.title])return; if(h.url&&haveU[h.url])return; if(h.title)haveT[h.title]=1; if(h.url)haveU[h.url]=1; added++; v.dynamics.push({id:'d'+Date.now()+Math.floor(Math.random()*1e4),title:h.title||'',url:h.url||'',summary:h.summary||'',date:h.date||'',source:h.source||src,addedAt:Date.now()}) } llm.forEach(function(h){push(h,'AI整理')}); pool.forEach(function(h){push(h,'匹配')}); v.lastFetch=Date.now(); if(v.dynamics.length>80)v.dynamics=v.dynamics.slice(0,80); try{persist()}catch(e){} renderVendorBody(v); renderCmpBlock(); toast('新增 '+added+' 条动态') }).catch(function(){toast('抓取失败')}) }
  window.openAddDyn=function(id){ CURVENDOR=id; ['vd_title','vd_url','vd_sum','vd_src'].forEach(function(i){var e=document.getElementById(i);if(e)e.value=''}); document.getElementById('vd_date').value=new Date().toISOString().slice(0,10); openMask('mVendorDyn') }
  window.saveAddDyn=function(){ var v=findVendor(CURVENDOR); if(!v)return; var title=(document.getElementById('vd_title').value||'').trim(); if(!title){toast('请填写标题');return} v.dynamics=v.dynamics||[]; v.dynamics.push({id:'d'+Date.now(),title:title,url:(document.getElementById('vd_url').value||'').trim(),summary:(document.getElementById('vd_sum').value||'').trim(),date:document.getElementById('vd_date').value||new Date().toISOString().slice(0,10),source:(document.getElementById('vd_src').value||'').trim()||'手动',addedAt:Date.now()}); try{persist()}catch(e){} closeMask('mVendorDyn'); renderVendorBody(v); renderCmpBlock(); toast('已录入并入库') }
  window.delVendorDyn=function(did){ var v=findVendor(CURVENDOR); if(!v||!confirm('删除该动态？'))return; v.dynamics=(v.dynamics||[]).filter(function(d){return d.id!==did}); try{persist()}catch(e){} renderVendorBody(v); renderCmpBlock() }
  window.delVendor=function(id){ var v=findVendor(id); if(!v||!confirm('删除厂商「'+v.name+'」及其动态？'))return; store.competitors.vendors=store.competitors.vendors.filter(function(x){return x.id!==id}); try{persist()}catch(e){} closeMask('mVendorView'); renderCmpBlock(); toast('已删除') }
  window.openAddVendor=function(){ ['av_name','av_alias','av_desc'].forEach(function(i){var e=document.getElementById(i);if(e)e.value=''}); document.getElementById('av_cat').innerHTML=Object.keys(CMP_CATS).map(function(k){return '<option value="'+k+'">'+CMP_CATS[k]+'</option>'}).join(''); document.getElementById('av_err').textContent=''; openMask('mVendorAdd') }
  window.saveAddVendor=function(){ var name=(document.getElementById('av_name').value||'').trim(); var err=document.getElementById('av_err'); if(!name){err.textContent='请填写厂商名称';return} store.competitors=store.competitors||{vendors:[],facts:[]}; store.competitors.vendors=store.competitors.vendors||[]; if(store.competitors.vendors.some(function(v){return v.name===name})){err.textContent='厂商已存在';return} store.competitors.vendors.push({id:'v'+Date.now(),name:name,category:document.getElementById('av_cat').value,aliases:(document.getElementById('av_alias').value||'').trim(),description:(document.getElementById('av_desc').value||'').trim(),dynamics:[]}); try{persist()}catch(e){} closeMask('mVendorAdd'); renderCmpBlock(); toast('已添加厂商') }
  window.cmpSearch=function(v){CMP_STATE.q=v||'';renderCmpBlock()}
  window.cmpFilter=function(c){CMP_STATE.cat=(CMP_STATE.cat===c?'':c);renderCmpBlock()}
  /* ================= 厂商动态 ================= */
  window.renderMarketDaily = function () {
    var el = document.getElementById('marketDailyBody'); if (!el) return
    ensureCompetitors()
    var E = canEditMarket()
    var vs = (store.competitors && store.competitors.vendors) || []
    var head = '<div class="mk-page-head"><div class="mk-stats">共 <b>' + vs.length + '</b> 家厂商 · 点厂商卡查看历史抓取明细，「⟳ 抓取」从已抓资讯中匹配该厂商动态</div>'
      + '<div class="mk-toolbar">' + (E ? '<button class="btn sm" onclick="openAddVendor()">＋ 添加厂商</button>' : '') + '</div></div>'
    el.innerHTML = head + '<div id="cmpBlock"></div>'
    renderCmpBlock()
  }
  window.mkDigestNow = function () { toast('生成中…'); api('/api/market/digest', { method: 'POST', body: '{}' }).then(function (r) { if (r.status === 200) { toast('已生成'); renderMarketDaily() } else toast((r.body && r.body.error) || '失败') }) }
  window.mkDelItem = function (id) { if (!confirm('删除该条？')) return; api('/api/market/item/' + id, { method: 'DELETE' }).then(function () { renderMarketDaily() }) }
})()
