/* ===== 能力提升：售前咨询必备常识（结构化知识条目）+ 售前人员能力培训材料（分类上传文件）（依赖 main.js persist/toast/openMask/closeMask，auth.js canEdit/currentRole） ===== */
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] }) }
  function canEdit() { var r = window.currentRole && window.currentRole(); return r === 'admin' || (window.canEdit && window.canEdit('capability')) }
  function fmtSize(n) { n = +n || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB' }
  // 必备常识分类（售前咨询能力）
  var KCATS = ['售前方法论', '技术方案编写', '商务与报价', '行业与政策', '客户沟通与引导', '招投标实务', '产品与方案知识', '安全与合规', '演讲与呈现', '其他'];
  // 培训材料分类
  var MCATS = ['入职与引导', '产品与方案', '售前技能', '案例复盘', '认证与考试', '外部课程', '模板与工具', '其他'];
  var CAP = { tab: 'k', q: '', kcat: '' };
  function inlineMd(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>') }
  function ensure() {
    store.capability = store.capability || {}
    if (!store.capability.items) { store.capability.items = CAP_SEED.slice(); store.capability.files = {}; persist() }
    store.capability.items = store.capability.items || []
    store.capability.files = store.capability.files || {}
    var have = {}; store.capability.items.forEach(function (x) { if (x.id) have[x.id] = 1 })
    var added = 0
    CAP_MIGRATE.forEach(function (seed) { if (!have[seed.id]) { store.capability.items.push(JSON.parse(JSON.stringify(seed))); added++ } })
    if (added) persist()
  }
  // 内置几条必备常识种子，避免空页；用户可增删
  var CAP_SEED = [
    { id: 'ck1', category: '售前方法论', title: '售前五步法：听、问、查、写、讲', content: '**听**：先听完客户业务与痛点，不急于推产品；**问**：用 SPIN（背景/难点/暗示/需求-收益）把隐性需求问成显性；**查**：现场核实系统规模、数据量、既有架构与集成点；**写**：方案先讲价值与场景，再讲功能与技术；**讲**：面向决策者讲收益、面向技术讲可行性，控制节奏留问答。', tags: '方法论,需求挖掘', updatedAt: Date.now() },
    { id: 'ck2', category: '技术方案编写', title: '方案骨架：背景-现状-需求-总体设计-分项-实施-案例-报价', content: '标准售前方案八段：①项目背景与建设目标；②客户现状与痛点；③需求理解与响应（逐条对标招标文件）；④总体架构设计（业务/应用/数据/技术四视图）；⑤分项功能与关键技术；⑥实施计划与团队；⑦同类案例与佐证；⑧投资概算与商务。要点：需求响应用“点对点应答表”，架构有图，案例可验证。', tags: '方案,投标', updatedAt: Date.now() },
    { id: 'ck3', category: '招投标实务', title: '点对点应答与废标红线', content: '技术标必须**逐条**响应招标参数，正偏离标“满足/优于”，不可空白或“详见”；商务标核对资质、业绩、授权、保证金、签字盖章、份数与密封。常见废标点：漏章漏签、报价超最高限价、工期/质保不满足、业绩证明材料缺失、有效期不足。', tags: '投标,废标', updatedAt: Date.now() }
  ];
  // 由「投标工具箱 · 方法论速查」迁移并入的必备常识（按 id 幂等补录，不复活用户已删的其他条目）
  var CAP_MIGRATE = [
    { id: 'ck4', category: '售前方法论', title: 'C139 模型速查', content: 'C=高质量教练确认（*C值）；1=决定者选定我方；3=三项价值共识；9=九大关键要素。核心逻辑：先建立教练，用教练校准信息，向 1Win 推进。**5C 为制胜拐点**，**6C（无 1Win）为死亡拐点**。', tags: 'C139,赢单,教练', updatedAt: Date.now() },
    { id: 'ck5', category: '售前方法论', title: '售前四步节奏', content: '①摸清背景（背景收集表 + C139 初评）→ ②首次交流建立信任（首次 PPT）→ ③方案价值耦合（技术 PPT + 高层汇报）→ ④招投标控标与高质量交付文件（Word + 述标 PPT）。', tags: '售前流程,节奏', updatedAt: Date.now() },
    { id: 'ck6', category: '招投标实务', title: '输标 / 流标复盘模板', content: '结果与分差 → C139 回看哪一环失真 → 信息 / 关系 / 方案 / 报价四维归因 → 知识库沉淀（竞品情报 / 客户档案更新）→ 改进项落到下个项目任务。', tags: '复盘,输标,流标', updatedAt: Date.now() }
  ];

  window.renderCapability = function () {
    var el = document.getElementById('capabilityBody'); if (!el) return
    ensure(); var E = canEdit()
    var items = store.capability.items, files = store.capability.files
    var fileTotal = Object.keys(files).reduce(function (s, k) { return s + (files[k] || []).length }, 0)
    var tabs = '<div class="cap-tabs">' +
      '<span class="cap-tab' + (CAP.tab === 'k' ? ' on' : '') + '" onclick="capTab(\'k\')">🧠 必备常识</span>' +
      '<span class="cap-tab' + (CAP.tab === 'm' ? ' on' : '') + '" onclick="capTab(\'m\')">📚 培训材料</span></div>'
    var head = '<div class="mk-page-head"><div class="mk-stats">必备常识 <b>' + items.length + '</b> 条 · 培训材料 <b>' + fileTotal + '</b> 份 · 常识分类 ' + Object.keys(items.reduce(function (o, x) { o[x.category] = 1; return o }, {})).length + ' 类</div>' +
      (E ? '<div class="mk-toolbar">' + (CAP.tab === 'k' ? '<button class="btn sm" onclick="openCap()">＋ 新增常识</button>' : '<label class="btn sm" style="cursor:pointer">⬆ 上传材料<input type="file" style="display:none" onchange="capUpload(this)"></label>') + '</div>' : '') + '</div>'
    el.innerHTML = head + tabs + (CAP.tab === 'k' ? renderKnow(E) : renderMat(E))
  }
  function renderKnow(E) {
    var q = CAP.q.toLowerCase()
    var list = store.capability.items.filter(function (it) {
      if (CAP.kcat && it.category !== CAP.kcat) return false
      if (q) { var hay = (it.title + ' ' + (it.content || '') + ' ' + (it.tags || '')).toLowerCase(); if (hay.indexOf(q) < 0) return false }
      return true
    }).slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0) })
    var chips = '<span class="cmp-chip' + (CAP.kcat === '' ? ' on' : '') + '" onclick="capKcat(\'\')">全部</span>' + KCATS.map(function (c) { return '<span class="cmp-chip' + (CAP.kcat === c ? ' on' : '') + '" onclick="capKcat(\'' + c + '\')">' + c + '</span>' }).join('')
    var items = list.map(function (it) {
      return '<div class="card cap-item"><div class="cmp-head"><h3 style="margin:0">' + esc(it.title) + '</h3><span class="tag cat">' + esc(it.category) + '</span>' + (E ? ' <button class="btn sm ghost" onclick="openCap(\'' + it.id + '\')">编辑</button> <button class="btn sm danger" onclick="delCap(\'' + it.id + '\')">删除</button>' : '') + '</div>' +
        (it.content ? '<div class="cap-body">' + inlineMd(it.content).replace(/\n/g, '<br>') + '</div>' : '') +
        '<div class="cap-meta">' + (it.tags ? '🏷 ' + esc(it.tags) : '') + '</div></div>'
    }).join('')
    return '<div class="card"><div class="cmp-tools"><input type="text" placeholder="搜索标题 / 内容 / 标签…" value="' + esc(CAP.q) + '" oninput="capKsearch(this.value)"></div><div class="cmp-chips">' + chips + '</div></div>' +
      (items || '<div class="card"><div class="empty">没有匹配的常识。' + (E ? '点右上「＋ 新增常识」补充售前必备知识。' : '') + '</div></div>')
  }
  function renderMat(E) {
    var files = store.capability.files
    var body = MCATS.map(function (c) {
      var fl = files[c] || []
      var list = fl.length ? fl.map(function (f) {
        return '<div class="tb-file"><span class="tb-fi">📄</span><div class="tb-fn"><b>' + esc(f.name) + '</b><small>' + fmtSize(f.size) + ' · ' + esc(f.date || '') + '</small></div>' +
          '<a class="btn sm ghost" href="/api/files/download/' + encodeURIComponent(f.fileId) + '" target="_blank">下载</a>' +
          (E ? '<button class="btn sm danger" onclick="capDelFile(\'' + esc(c) + '\',\'' + f.fileId + '\')">删除</button>' : '') + '</div>'
      }).join('') : '<div class="empty" style="padding:10px">该分类暂无材料</div>'
      return '<div class="card cap-mat"><div class="cmp-head"><h3 style="margin:0">' + c + '<span class="tag" style="margin-left:8px">' + fl.length + '</span></h3>' + (E ? '<label class="btn sm ghost" style="cursor:pointer">⬆ 上传<input type="file" style="display:none" onchange="capUpload(this,\'' + c + '\')"></label>' : '') + '</div>' + list + '</div>'
    }).join('')
    return '<div class="hint" style="margin-bottom:10px">按分类存放售前能力培训材料（课件、手册、认证题库、复盘文档等），支持任意格式，上传后可下载。</div>' + body
  }

  /* ---- 交互 ---- */
  window.capTab = function (t) { CAP.tab = t; renderCapability() }
  window.capKsearch = function (v) { CAP.q = v || ''; var el = document.querySelector('#capabilityBody .cap-item'); renderCapability(); var inp = document.querySelector('#capabilityBody .cmp-tools input'); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length) } }
  window.capKcat = function (c) { CAP.kcat = (CAP.kcat === c ? '' : c); renderCapability() }
  window.openCap = function (id) {
    var it = id ? store.capability.items.find(function (x) { return x.id === id }) : null
    document.getElementById('capModalTitle').textContent = it ? '编辑常识' : '新增常识'
    document.getElementById('ckId').value = it ? it.id : ''
    document.getElementById('ckTitle').value = it ? it.title : ''
    document.getElementById('ckTags').value = it ? (it.tags || '') : ''
    document.getElementById('ckContent').value = it ? (it.content || '') : ''
    document.getElementById('ckCat').innerHTML = KCATS.map(function (c) { return '<option' + (it && it.category === c ? ' selected' : '') + '>' + c + '</option>' }).join('')
    openMask('mCap')
  }
  window.saveCap = function () {
    var title = document.getElementById('ckTitle').value.trim(); if (!title) { toast('请填写标题'); return }
    store.capability.items = store.capability.items || []
    var id = document.getElementById('ckId').value
    var data = { id: id || ('ck' + Date.now()), title: title, category: document.getElementById('ckCat').value, tags: document.getElementById('ckTags').value.trim(), content: document.getElementById('ckContent').value.trim(), updatedAt: Date.now() }
    if (id) { var i = store.capability.items.findIndex(function (x) { return x.id === id }); if (i > -1) { data.updatedAt = Date.now(); store.capability.items[i] = data } } else store.capability.items.push(data)
    persist(); closeMask('mCap'); renderCapability(); toast('已保存')
  }
  window.delCap = function (id) { if (!confirm('删除该条常识？')) return; store.capability.items = (store.capability.items || []).filter(function (x) { return x.id !== id }); persist(); renderCapability(); toast('已删除') }
  window.capUpload = function (inp, cat) {
    if (!inp.files || !inp.files[0]) return
    var category = cat || MCATS[0]; var file = inp.files[0]
    toast('上传中…')
    fetch('/api/files/upload', { method: 'POST', headers: { 'x-filename': encodeURIComponent(file.name) }, body: file }).then(function (r) { return r.json() }).then(function (d) {
      if (!d.ok) throw new Error(d.error || '失败')
      store.capability.files[category] = store.capability.files[category] || []
      store.capability.files[category].push({ fileId: d.fileId, name: d.name, size: d.size, date: new Date().toISOString().slice(0, 10) })
      persist(); CAP.tab = 'm'; renderCapability(); toast('已上传到「' + category + '」')
    }).catch(function (e) { toast('上传失败：' + e.message) }); inp.value = ''
  }
  window.capDelFile = function (cat, fileId) { if (!confirm('删除该材料？')) return; fetch('/api/files/' + encodeURIComponent(fileId), { method: 'DELETE' }).catch(function () { }); store.capability.files[cat] = (store.capability.files[cat] || []).filter(function (f) { return f.fileId !== fileId }); persist(); renderCapability(); toast('已删除') }
})()
