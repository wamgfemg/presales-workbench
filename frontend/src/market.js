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
  window.renderMarket = function () {
    var el = document.getElementById('marketBody'); if (!el) return
    api('/api/market').then(function (r) {
      if (r.status !== 200) { el.innerHTML = '<div class="card"><div class="empty">加载失败或无权限</div></div>'; return }
      MKT = r.body; var E = canEditMarket(); var st = MKT.stats || {}
      var toolbar = '<div class="mk-toolbar">'
        + (E ? '<button class="btn sm" id="mkFetchBtn" onclick="mkFetchNow()">⟳ 立即抓取</button><button class="btn sm" onclick="openMkGen()">＋ 生成报告</button><button class="btn sm ghost" onclick="openMkImport()">📥 录入资料</button>' : '')
        + '<button class="btn sm ghost" onclick="openMkSources()">🔗 资讯来源</button></div>'
      var head = '<div class="mk-page-head"><div class="mk-stats">共 <b>' + (MKT.items || []).length + '</b> 条资讯 · 上次抓取 ' + (st.lastRun ? dt(st.lastRun) : '从未') + '</div>' + toolbar + '</div>'
      var reports = (MKT.briefs || []).filter(function (b) { return b.type !== 'digest' })
      var table
      if (!reports.length) {
        table = '<div class="card"><div class="empty">还没有报告。点右上「＋ 生成报告」，勾选近期资讯或粘贴素材，AI 会生成竞品对比表 / 行业简报。<div style="margin-top:12px">' + (E ? '<button class="btn" onclick="openMkGen()">＋ 生成报告</button>' : '') + '</div></div></div>'
      } else {
        var rows = reports.map(function (b) {
          var tag = b.type === 'compare' ? '<span class="mk-badge mk-badge-c">竞品对比</span>' : '<span class="mk-badge mk-badge-b">行业简报</span>'
          var prev = String(b.output || '').replace(/[#*`>|]/g, ' ').replace(/[-]{2,}/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70)
          return '<tr class="mk-row" onclick="viewReport(\'' + b.id + '\')">'
            + '<td class="mk-rt-title"><b>' + esc(b.title) + '</b><div class="mk-rt-prev">' + esc(prev) + '…</div></td>'
            + '<td>' + tag + '</td>'
            + '<td class="mk-rt-time">' + dt(b.createdAt) + '</td>'
            + '<td class="mk-rt-cnt">' + ((b.refs && b.refs.length) || '—') + '</td>'
            + '<td>' + (E ? '<button class="btn sm ghost" onclick="event.stopPropagation();mkDelBrief(\'' + b.id + '\')">删除</button>' : '') + '</td></tr>'
        }).join('')
        table = '<div class="card mk-reports-card"><div style="overflow-x:auto"><table class="mk-reports"><tr><th>报告</th><th style="width:96px">类型</th><th style="width:150px">生成时间</th><th style="width:64px">素材</th><th style="width:72px">操作</th></tr>' + rows + '</table></div></div>'
      }
      el.innerHTML = head + table
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

  /* ================= 每日市场动态 ================= */
  window.renderMarketDaily = function () {
    var el = document.getElementById('marketDailyBody'); if (!el) return
    api('/api/market').then(function (r) {
      if (r.status !== 200) { el.innerHTML = '<div class="card"><div class="empty">加载失败或无权限</div></div>'; return }
      MKT = r.body; var E = canEditMarket()
      var digest = (MKT.briefs || []).filter(function (b) { return b.type === 'digest' }).slice(0, 1)[0]
      var digestHtml = digest ? '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">📰 ' + esc(digest.title) + '</h3>' + (E ? '<button class="btn sm ghost" onclick="mkDigestNow()">重新生成</button>' : '') + '</div><div class="mk-report-body">' + mkMd(digest.output) + '</div></div>'
        : '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">📰 今日动态摘要</h3>' + (E ? '<button class="btn sm" onclick="mkDigestNow()">生成今日摘要</button>' : '') + '</div><div class="empty" style="padding:14px">尚未生成。系统每日 08:00 自动抓取并生成，也可手动点「生成」。</div></div>'
      var groups = {}, order = []
      ;(MKT.items || []).forEach(function (it) { var d = dayStr(it.publishedTs || it.fetchedAt); if (!groups[d]) { groups[d] = []; order.push(d) } groups[d].push(it) })
      var body = order.slice(0, 30).map(function (d) {
        return '<div class="card"><h3>' + d + ' <span class="tag">' + groups[d].length + ' 条</span></h3>' + groups[d].slice(0, 40).map(function (it) {
          return '<div class="mk-item"><div class="mk-item-h">' + (it.url ? '<a href="' + esc(it.url) + '" target="_blank">' + esc(it.title) + '</a>' : esc(it.title)) + '</div>' +
            '<div class="mk-item-m"><span class="tag">' + esc(it.sourceName) + '</span>' + (it.published ? ' <span>' + esc(it.published) + '</span>' : '') + (E ? ' <button class="btn sm ghost" style="float:right;padding:2px 8px" onclick="mkDelItem(\'' + it.id + '\')">删除</button>' : '') + '</div>' +
            (it.summary ? '<div class="mk-item-s">' + esc(it.summary) + '</div>' : '') +
            (it.points ? '<div class="mk-item-p">' + mkMd(it.points) + '</div>' : '') + '</div>'
        }).join('') + '</div>'
      }).join('')
      el.innerHTML = digestHtml + (body || '<div class="card"><div class="empty">暂无抓取到的资讯，请到「市场情报」点「立即抓取」。</div></div>')
    })
  }
  window.mkDigestNow = function () { toast('生成中…'); api('/api/market/digest', { method: 'POST', body: '{}' }).then(function (r) { if (r.status === 200) { toast('已生成'); renderMarketDaily() } else toast((r.body && r.body.error) || '失败') }) }
  window.mkDelItem = function (id) { if (!confirm('删除该条？')) return; api('/api/market/item/' + id, { method: 'DELETE' }).then(function () { renderMarketDaily() }) }
})()
