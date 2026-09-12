/* ===== AI应用日报前端：日报清单 + 详情 + 收录/链接管理（依赖 main.js toast/openMask/closeMask，auth.js canEdit/currentRole） ===== */
(function () {
  var AD = { links: [], reports: [], stats: {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] }) }
  function canEdit() { var r = window.currentRole && window.currentRole(); return r === 'admin' || (window.canEdit && window.canEdit('aidaily')) }
  function api(url, opts) { return fetch(url, Object.assign({ headers: { 'content-type': 'application/json' } }, opts || {})).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j } }).catch(function () { return { status: r.status, body: {} } }) }) }
  function dt(ts) { return new Date(ts).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-') }

  function inline(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>') }
  function mkMd(src) {
    var lines = String(src || '').split(/\r?\n/), html = '', para = []
    function flush() { if (para.length) { html += '<p>' + inline(para.join(' ')) + '</p>'; para = [] } }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i]
      if (/^\s*$/.test(ln)) { flush(); continue }
      var hm = /^(#{1,4})\s+(.*)$/.exec(ln); if (hm) { flush(); var lv = hm[1].length; html += '<h' + lv + '>' + inline(hm[2]) + '</h' + lv + '>'; continue }
      var lm = /^\s*[-*·]\s+(.*)$/.exec(ln); if (lm) { flush(); html += '<div class="mk-li">· ' + inline(lm[1]) + '</div>'; continue }
      para.push(ln.trim())
    }
    flush(); return html
  }

  window.renderAidaily = function () {
    var el = document.getElementById('aidailyBody'); if (!el) return
    api('/api/aidaily').then(function (r) {
      if (r.status !== 200) { el.innerHTML = '<div class="card"><div class="empty">加载失败或无权限</div></div>'; return }
      AD = r.body; var E = canEdit()
      var toolbar = '<div class="mk-toolbar">' + (E ? '<button class="btn sm" onclick="openAdLink()">＋ 收录日报</button><button class="btn sm" id="adFetchBtn" onclick="adFetch()">⟳ 立即处理</button>' : '') + '<button class="btn sm ghost" onclick="openAdLinks()">🔗 链接管理</button></div>'
      var head = '<div class="mk-page-head"><div class="mk-stats">共 <b>' + (AD.reports || []).length + '</b> 份日报 · 已配置链接 ' + (AD.links || []).length + ' 条 · 上次处理 ' + (AD.stats && AD.stats.lastRun ? dt(AD.stats.lastRun) : '从未') + '</div>' + toolbar + '</div>'
      var note = '<div class="hint">微信公众号无 RSS、每篇是固定链接，系统无法自动发现“明天”的那篇。请每天把「静言波语」最新日报链接用「＋ 收录日报」贴进来，即会自动抓取并整理归档；已收录链接每日 09:00 也会自动补处理新篇。</div>'
      var reports = AD.reports || []
      var table
      if (!reports.length) table = '<div class="card"><div class="empty">还没有日报。点「＋ 收录日报」粘贴一篇《企业级AI应用日报》链接，AI 会自动整理成结构化日报。<div style="margin-top:12px">' + (E ? '<button class="btn" onclick="openAdLink()">＋ 收录日报</button>' : '') + '</div></div></div>'
      else {
        var rows = reports.map(function (rep) {
          var prev = String(rep.output || '').replace(/[#*>-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70)
          return '<tr class="mk-row" onclick="adView(\'' + rep.id + '\')">'
            + '<td class="mk-rt-title"><b>' + esc(rep.title) + '</b><div class="mk-rt-prev">' + esc(prev) + '…</div></td>'
            + '<td class="mk-rt-time">' + esc(rep.date || '') + '</td>'
            + '<td>' + (rep.url ? '<a class="mk-src" href="' + esc(rep.url) + '" target="_blank" onclick="event.stopPropagation()">原文</a>' : '—') + '</td>'
            + '<td>' + (E ? '<button class="btn sm ghost" onclick="event.stopPropagation();adDel(\'' + rep.id + '\')">删除</button>' : '') + '</td></tr>'
        }).join('')
        table = '<div class="card mk-reports-card"><div style="overflow-x:auto"><table class="mk-reports"><tr><th>日报</th><th style="width:110px">日期</th><th style="width:60px">原文</th><th style="width:64px">操作</th></tr>' + rows + '</table></div></div>'
      }
      el.innerHTML = head + note + table
    })
  }

  window.adView = function (id) {
    var rep = (AD.reports || []).find(function (x) { return x.id === id }); if (!rep) return
    document.getElementById('adViewTitle').textContent = 'AI 应用日报'
    document.getElementById('adViewBody').innerHTML = '<div class="mk-report">'
      + '<div class="mk-report-head"><span class="mk-report-kicker">企业级 AI 应用日报</span><h2>' + esc(rep.title) + '</h2>'
      + '<div class="mk-report-meta"><span>' + esc(rep.date || '') + '</span>' + (rep.nickname ? '<span>来源：' + esc(rep.nickname) + '</span>' : '') + (rep.url ? '<a href="' + esc(rep.url) + '" target="_blank">查看原文</a>' : '') + '<span>AI 整理，供参考</span></div></div>'
      + '<div class="mk-report-body">' + mkMd(rep.output) + '</div></div>'
    openMask('mAdView')
  }
  window.openAdLink = function () { document.getElementById('adLinkUrl').value = ''; document.getElementById('adLinkErr').textContent = ''; openMask('mAdLink') }
  window.submitAdLink = function () {
    var url = document.getElementById('adLinkUrl').value.trim(), err = document.getElementById('adLinkErr'); err.textContent = ''
    if (!url) { err.textContent = '请粘贴日报链接'; return }
    var b = document.querySelectorAll('#mAdLink button'); b.forEach(function (x) { x.disabled = true }); toast('抓取整理中，约需 1 分钟…')
    api('/api/aidaily/link', { method: 'POST', body: JSON.stringify({ url: url }) }).then(function (r) { b.forEach(function (x) { x.disabled = false }); if (r.status === 200) { closeMask('mAdLink'); toast('日报已收录整理'); renderAidaily() } else err.textContent = (r.body && r.body.error) || '收录失败' }).catch(function () { b.forEach(function (x) { x.disabled = false }); err.textContent = '收录失败' })
  }
  window.adFetch = function () { var b = document.getElementById('adFetchBtn'); if (b) { b.disabled = true; b.textContent = '处理中…' } api('/api/aidaily/fetch', { method: 'POST', body: '{}' }).then(function (r) { if (b) { b.disabled = false; b.textContent = '⟳ 立即处理' } if (r.status === 200) { toast('已处理，新增 ' + (r.body.added || 0) + ' 份'); renderAidaily() } else toast((r.body && r.body.error) || '失败') }).catch(function () { if (b) { b.disabled = false; b.textContent = '⟳ 立即处理' } }) }
  window.openAdLinks = function () { api('/api/aidaily').then(function (r) { if (r.status === 200) AD = r.body; renderAdLinksModal() }); openMask('mAdLinks') }
  function renderAdLinksModal() {
    var E = canEdit()
    var rows = (AD.links || []).map(function (l) { return '<tr><td class="mk-url">' + esc(l.url) + '</td><td style="white-space:nowrap">' + (E ? '<button class="btn sm danger" onclick="adDelLink(\'' + l.id + '\')">删除</button>' : '') + '</td></tr>' }).join('')
    document.getElementById('adLinksBody').innerHTML = '<div style="overflow-x:auto"><table><tr><th>已配置链接</th><th style="width:80px">操作</th></tr>' + (rows || '<tr><td colspan="2" class="empty">暂无链接</td></tr>') + '</table></div>'
      + (E ? '<div class="mk-src-add"><input id="adLinkAdd" placeholder="粘贴一篇日报链接 https://mp.weixin.qq.com/s/…"><button class="btn sm" onclick="adAddLink()">＋ 添加并整理</button></div>' : '')
  }
  window.adAddLink = function () { var url = document.getElementById('adLinkAdd').value.trim(); if (!url) { toast('请输入链接'); return } toast('抓取整理中…'); api('/api/aidaily/link', { method: 'POST', body: JSON.stringify({ url: url }) }).then(function (r) { if (r.status === 200) { toast('已收录'); api('/api/aidaily').then(function (x) { if (x.status === 200) AD = x.body; renderAdLinksModal(); renderAidaily() }) } else toast((r.body && r.body.error) || '失败') }) }
  window.adDelLink = function (id) { if (!confirm('删除该链接？（已生成的日报保留）')) return; api('/api/aidaily/link/' + id, { method: 'DELETE' }).then(function () { api('/api/aidaily').then(function (x) { if (x.status === 200) AD = x.body; renderAdLinksModal() }) }) }
  window.adDel = function (id) { if (!confirm('删除该日报？')) return; api('/api/aidaily/report/' + id, { method: 'DELETE' }).then(function () { renderAidaily() }) }
})()
