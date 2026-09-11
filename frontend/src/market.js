/* ===== 市场情报前端：市场资料整理 Agent + 每日市场动态（依赖 main.js 的 toast/openMask/closeMask，auth.js 的 canEdit/currentRole） ===== */
(function () {
  var MKT = { sources: [], items: [], briefs: [], stats: {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] }) }
  function canEditMarket() { var r = window.currentRole && window.currentRole(); return r === 'admin' || (window.canEdit && window.canEdit('market')) }
  function api(url, opts) { return fetch(url, Object.assign({ headers: { 'content-type': 'application/json' } }, opts || {})).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j } }).catch(function () { return { status: r.status, body: {} } }) }) }
  function dayStr(ts) { return new Date((ts || 0) + 8 * 3600e3).toISOString().slice(0, 10) }

  /* ---- 轻量 Markdown（含表格） ---- */
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

  /* ================= 市场情报整理 ================= */
  window.renderMarket = function () {
    var el = document.getElementById('marketBody'); if (!el) return
    api('/api/market').then(function (r) {
      if (r.status !== 200) { el.innerHTML = '<div class="card"><div class="empty">加载失败或无权限</div></div>'; return }
      MKT = r.body; var E = canEditMarket()
      var srcRows = (MKT.sources || []).map(function (s) {
        return '<tr><td>' + esc(s.name) + '</td><td class="mk-url">' + esc(s.url) + '</td><td>' + (s.active === false ? '<span class="tag">停用</span>' : '<span class="tag" style="background:#e6f4ea;color:#2f9e44">启用</span>') + '</td>' +
          (E ? '<td style="white-space:nowrap"><button class="btn sm ghost" onclick="mkToggleSource(\'' + s.id + '\',' + (s.active === false) + ')">' + (s.active === false ? '启用' : '停用') + '</button> <button class="btn sm danger" onclick="mkDelSource(\'' + s.id + '\')">删除</button></td>' : '<td></td>') + '</tr>'
      }).join('')
      var briefs = (MKT.briefs || []).filter(function (b) { return b.type !== 'digest' }).map(function (b) {
        return '<div class="card mk-brief"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">' + (b.type === 'compare' ? '🔍 竞品对比：' : '📊 行业简报：') + esc(b.title) + '</h3>' + (E ? '<button class="btn sm ghost" onclick="mkDelBrief(\'' + b.id + '\')">删除</button>' : '') + '</div><div class="mk-out">' + mkMd(b.output) + '</div><div class="mk-time">' + new Date(b.createdAt).toLocaleString('zh-CN', { hour12: false }) + '</div></div>'
      }).join('') || '<div class="empty">还没有整理成果。用下方「AI 整理」生成竞品对比表或行业简报。</div>'
      var recent = (MKT.items || []).slice(0, 25).map(function (it) {
        return '<label class="mk-pick"><input type="checkbox" value="' + it.id + '"> <b>' + esc(it.title) + '</b><span class="mk-pick-meta">' + esc(it.sourceName) + ' · ' + (it.published || dayStr(it.fetchedAt)) + '</span></label>'
      }).join('') || '<div class="empty" style="padding:8px">暂无条目，点右上「立即抓取」或到「每日市场动态」查看。</div>'

      el.innerHTML =
        '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0">资讯来源</h3>' + (E ? '<div style="display:flex;gap:8px"><button class="btn sm" id="mkFetchBtn" onclick="mkFetchNow()">⟳ 立即抓取</button><button class="btn sm ghost" onclick="openMkSource()">＋ 添加来源</button></div>' : '') + '</div>' +
        '<div style="overflow-x:auto"><table><tr><th>名称</th><th>源地址</th><th>状态</th>' + (E ? '<th style="width:150px">操作</th>' : '') + '</tr>' + (srcRows || '<tr><td colspan="4" class="empty">暂无来源</td></tr>') + '</table></div>' +
        '<div class="hint" style="margin-top:8px">RSS 源每日 08:00 自动抓取。政府政策类站点多无规范 RSS、易被反爬，建议用下方「抓取网页/粘贴原文」补录。</div></div>' +
        (E ?
          '<div class="card"><h3>录入资料</h3>' +
          '<div class="grid g2" style="align-items:end"><label class="f"><span>抓取网页正文（填文章/政策页 URL）</span><div style="display:flex;gap:8px"><input id="mkImpUrl" placeholder="https://…"><button class="btn" onclick="mkImportUrl()">抓取并提炼</button></div></label></div>' +
          '<label class="f"><span>或直接粘贴原文（政策/竞品资料）</span><input id="mkImpTitle" placeholder="标题（可空）" style="margin-bottom:6px"><textarea id="mkImpText" rows="3" placeholder="粘贴正文，AI 将提炼要点并归档"></textarea></label>' +
          '<button class="btn ghost" onclick="mkImportText()">提炼要点并归档</button></div>' +
          '<div class="card"><h3>AI 整理</h3><div class="hint">勾选下方近期条目作为素材（或在补充框粘贴内容），生成竞品对比表 / 行业简报。</div>' +
          '<div class="mk-picks">' + recent + '</div>' +
          '<label class="f" style="margin-top:8px"><span>补充素材（可选）</span><textarea id="mkOrgText" rows="2" placeholder="额外粘贴竞品参数、政策条款等"></textarea></label>' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input id="mkOrgTitle" placeholder="成果标题（可空）" style="max-width:240px"><button class="btn" onclick="mkOrganize(\'compare\')">🔍 生成竞品对比表</button><button class="btn ghost" onclick="mkOrganize(\'brief\')">📊 生成行业简报</button></div></div>'
          : '') +
        '<div class="card"><h3>整理成果</h3>' + briefs + '</div>'
    })
  }
  window.mkFetchNow = function () { var b = document.getElementById('mkFetchBtn'); if (b) { b.disabled = true; b.textContent = '抓取中…' } api('/api/market/fetch', { method: 'POST', body: '{}' }).then(function (r) { if (b) { b.disabled = false; b.textContent = '⟳ 立即抓取' } if (r.status === 200) { toast('抓取完成，新增 ' + (r.body.added || 0) + ' 条'); renderMarket() } else toast((r.body && r.body.error) || '抓取失败') }).catch(function () { if (b) { b.disabled = false; b.textContent = '⟳ 立即抓取' } toast('抓取失败') }) }
  window.openMkSource = function () { var name = prompt('来源名称：'); if (name === null) return; var url = prompt('RSS/Atom 源地址：'); if (!url) return; api('/api/market/source', { method: 'POST', body: JSON.stringify({ name: name, url: url }) }).then(function (r) { if (r.status === 200) { toast('已添加'); renderMarket() } else toast((r.body && r.body.error) || '失败') }) }
  window.mkToggleSource = function (id, active) { api('/api/market/source/' + id, { method: 'PUT', body: JSON.stringify({ active: !!active }) }).then(function () { renderMarket() }) }
  window.mkDelSource = function (id) { if (!confirm('删除该来源？')) return; api('/api/market/source/' + id, { method: 'DELETE' }).then(function () { renderMarket() }) }
  window.mkImportUrl = function () { var u = document.getElementById('mkImpUrl').value.trim(); if (!u) { toast('请输入 URL'); return } toast('抓取中…'); api('/api/market/import', { method: 'POST', body: JSON.stringify({ url: u }) }).then(function (r) { if (r.status === 200) { toast('已提炼归档'); document.getElementById('mkImpUrl').value = ''; renderMarket() } else toast((r.body && r.body.error) || '失败') }) }
  window.mkImportText = function () { var t = document.getElementById('mkImpText').value.trim(); if (!t) { toast('请粘贴原文'); return } toast('提炼中…'); api('/api/market/import', { method: 'POST', body: JSON.stringify({ title: document.getElementById('mkImpTitle').value.trim(), text: t }) }).then(function (r) { if (r.status === 200) { toast('已提炼归档'); document.getElementById('mkImpText').value = ''; document.getElementById('mkImpTitle').value = ''; renderMarket() } else toast((r.body && r.body.error) || '失败') }) }
  window.mkOrganize = function (type) {
    var ids = [].slice.call(document.querySelectorAll('.mk-picks input:checked')).map(function (x) { return x.value })
    var extra = (document.getElementById('mkOrgText').value || '').trim(); var title = document.getElementById('mkOrgTitle').value.trim()
    if (!ids.length && !extra) { toast('请勾选条目或粘贴补充素材'); return }
    toast('AI 整理中，请稍候…')
    api('/api/market/organize', { method: 'POST', body: JSON.stringify({ type: type, itemIds: ids, text: extra, title: title }) }).then(function (r) { if (r.status === 200) { toast('已生成'); renderMarket() } else toast((r.body && r.body.error) || '整理失败') }).catch(function () { toast('整理失败') })
  }
  window.mkDelBrief = function (id) { if (!confirm('删除该成果？')) return; api('/api/market/brief/' + id, { method: 'DELETE' }).then(function () { renderMarket() }) }

  /* ================= 每日市场动态 ================= */
  window.renderMarketDaily = function () {
    var el = document.getElementById('marketDailyBody'); if (!el) return
    api('/api/market').then(function (r) {
      if (r.status !== 200) { el.innerHTML = '<div class="card"><div class="empty">加载失败或无权限</div></div>'; return }
      MKT = r.body; var E = canEditMarket()
      var digest = (MKT.briefs || []).filter(function (b) { return b.type === 'digest' }).slice(0, 1)[0]
      var digestHtml = digest ? '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">📰 ' + esc(digest.title) + '</h3>' + (E ? '<button class="btn sm ghost" onclick="mkDigestNow()">重新生成</button>' : '') + '</div><div class="mk-out">' + mkMd(digest.output) + '</div></div>'
        : '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">📰 今日动态摘要</h3>' + (E ? '<button class="btn sm" onclick="mkDigestNow()">生成今日摘要</button>' : '') + '</div><div class="empty" style="padding:14px">尚未生成。系统每日 08:00 自动抓取并生成，也可手动点「生成」。</div></div>'
      // 按天分组
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
