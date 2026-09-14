/* ===== 售前工具箱：按解决方案组织的文档分类树，每个节点可上传/下载文件（依赖 main.js persist/toast，auth.js canEdit/currentRole） ===== */
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] }) }
  function canEdit() { var r = window.currentRole && window.currentRole(); return r === 'admin' || (window.canEdit && window.canEdit('toolbox')) }
  var TB_TREE = [
    { key: 'cust', label: '客户展示', children: [{ key: 'cust_color', label: '彩页' }, { key: 'cust_manual', label: '产品手册' }, { key: 'cust_white', label: '白皮书' }, { key: 'cust_one', label: '一指禅/一页纸' }, { key: 'cust_case', label: '典型案例' }, { key: 'cust_line', label: '业务线介绍' }] },
    { key: 'train', label: '销售培训', children: [{ key: 'train_biz', label: '销售业务培训资料' }, { key: 'train_one', label: '一指禅/一页纸' }, { key: 'train_case', label: '典型案例' }] },
    { key: 'tools', label: '其他', children: [{ key: 'tools_quote', label: '报价模版' }, { key: 'tools_visit', label: '拜访函模版' }, { key: 'tools_partner', label: '伙伴联合方案' }, { key: 'tools_faq', label: 'FAQ' }] }
  ]
  var TB = { sol: null, node: 'cust_color' }
  function nodeLabel(key) { for (var i = 0; i < TB_TREE.length; i++) { var g = TB_TREE[i]; for (var j = 0; j < g.children.length; j++) if (g.children[j].key === key) return g.label + ' / ' + g.children[j].label } return key }
  function ensure() {
    store.toolbox = store.toolbox || {}
    if (!store.toolbox.solutions) { store.toolbox.solutions = [{ id: 'sol1', name: '数据中心DCIM' }, { id: 'sol2', name: '智能运维AIOps' }, { id: 'sol3', name: '资产管理系统' }, { id: 'sol4', name: '机房动环监控' }]; store.toolbox.files = {}; persist() }
    store.toolbox.files = store.toolbox.files || {}
    var sols = store.toolbox.solutions
    if (!sols.some(function (s) { return s.id === TB.sol })) TB.sol = sols.length ? sols[0].id : null
  }
  function files(key) { return store.toolbox.files[key] || [] }

  window.renderToolbox = function () {
    var el = document.getElementById('toolboxBody'); if (!el) return
    ensure(); var E = canEdit(); var sols = store.toolbox.solutions
    var solOpts = sols.map(function (s) { return '<option value="' + s.id + '"' + (s.id === TB.sol ? ' selected' : '') + '>' + esc(s.name) + '</option>' }).join('')
    var head = '<div class="mk-page-head"><div class="mk-stats">解决方案：<b>' + esc((sols.find(function (s) { return s.id === TB.sol }) || {}).name || '—') + '</b> · 当前分类：' + esc(nodeLabel(TB.node)) + '</div>' +
      '<div class="mk-toolbar"><select id="tbSol" onchange="tbPickSol(this.value)" style="width:200px">' + solOpts + '</select>' + (E ? '<button class="btn sm ghost" onclick="tbAddSol()">＋解决方案</button>' + (TB.sol ? '<button class="btn sm ghost" onclick="tbDelSol()">删解决方案</button>' : '') : '') + '</div></div>'
    if (!sols.length) { el.innerHTML = head + '<div class="card"><div class="empty">还没有解决方案，点右上「＋解决方案」添加。</div></div>'; return }
    // tree
    var tree = TB_TREE.map(function (g) {
      return '<div class="tb-group"><div class="tb-glabel">' + g.label + '</div>' + g.children.map(function (c) {
        var n = files(TB.sol + '|' + c.key).length
        return '<div class="tb-node' + (c.key === TB.node ? ' on' : '') + '" onclick="tbPickNode(\'' + c.key + '\')">' + c.label + (n ? '<span class="tb-cnt">' + n + '</span>' : '') + '</div>'
      }).join('') + '</div>'
    }).join('')
    // files of current node
    var key = TB.sol + '|' + TB.node
    var fl = files(key)
    var fileList = fl.length ? fl.map(function (f) {
      return '<div class="tb-file"><span class="tb-fi">📄</span><div class="tb-fn"><b>' + esc(f.name) + '</b><small>' + fmtSize(f.size) + ' · ' + esc(f.date || '') + '</small></div>' +
        '<a class="btn sm ghost" href="/api/files/download/' + encodeURIComponent(f.fileId) + '" target="_blank">下载</a>' +
        (E ? '<button class="btn sm danger" onclick="tbDelFile(\'' + f.fileId + '\')">删除</button>' : '') + '</div>'
    }).join('') : '<div class="empty">该分类下暂无文件' + (E ? '，点「⬆ 上传文件」添加' : '') + '</div>'
    var main = '<div class="card"><div class="cmp-head"><h3 style="margin:0">' + esc(nodeLabel(TB.node)) + '</h3>' + (E ? '<label class="btn sm" style="cursor:pointer">⬆ 上传文件<input type="file" style="display:none" onchange="tbUpload(this)"></label>' : '') + '</div><div id="tbFileList">' + fileList + '</div></div>'
    el.innerHTML = head + '<div class="tb-layout"><div class="tb-side">' + tree + '</div><div class="tb-main">' + main + '</div></div>'
  }
  function fmtSize(n) { n = +n || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB' }
  window.tbPickSol = function (v) { TB.sol = v; renderToolbox() }
  window.tbPickNode = function (k) { TB.node = k; renderToolbox() }
  window.tbAddSol = function () { var name = prompt('解决方案 / 产品线名称：'); if (!name || !name.trim()) return; store.toolbox.solutions.push({ id: 'sol' + Date.now(), name: name.trim() }); TB.sol = store.toolbox.solutions[store.toolbox.solutions.length - 1].id; persist(); renderToolbox(); toast('已添加') }
  window.tbDelSol = function () { var s = (store.toolbox.solutions || []).find(function (x) { return x.id === TB.sol }); if (!s || !confirm('删除解决方案「' + s.name + '」及其所有文件记录？')) return; store.toolbox.solutions = store.toolbox.solutions.filter(function (x) { return x.id !== TB.sol }); Object.keys(store.toolbox.files).forEach(function (k) { if (k.indexOf(TB.sol + '|') === 0) delete store.toolbox.files[k] }); TB.sol = null; persist(); renderToolbox(); toast('已删除') }
  window.tbUpload = function (inp) { if (!inp.files || !inp.files[0] || !TB.sol) return; var file = inp.files[0]; toast('上传中…'); fetch('/api/files/upload', { method: 'POST', headers: { 'x-filename': encodeURIComponent(file.name) }, body: file }).then(function (r) { return r.json() }).then(function (d) { if (!d.ok) throw new Error(d.error || '失败'); var key = TB.sol + '|' + TB.node; store.toolbox.files[key] = store.toolbox.files[key] || []; store.toolbox.files[key].push({ fileId: d.fileId, name: d.name, size: d.size, date: new Date().toISOString().slice(0, 10) }); persist(); renderToolbox(); toast('已上传') }).catch(function (e) { toast('上传失败：' + e.message) }); inp.value = '' }
  window.tbDelFile = function (fileId) { if (!confirm('删除该文件？')) return; fetch('/api/files/' + encodeURIComponent(fileId), { method: 'DELETE' }).catch(function () { }); var key = TB.sol + '|' + TB.node; store.toolbox.files[key] = (store.toolbox.files[key] || []).filter(function (f) { return f.fileId !== fileId }); persist(); renderToolbox(); toast('已删除') }
})()
