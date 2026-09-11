/* ================= 向量知识库 · WeKnora 真实对接（覆盖 main.js 中的同名函数） ================= */
let WEK = { enabled: null, base: null, items: [], loading: false, error: '', loadedAt: 0, kbs: [], kbId: '' }

/* 目录归属映射：WeKnora 文档本身不带目录，目录是前端本地组织层。
   键=文档 id，值=目录节点 id（null/缺失 = 未归类，仅出现在「全部知识」）。
   归属后端持久化（/api/weknora/doc-category），localStorage 仅作离线回退，保证跨浏览器/跨设备一致。 */
let WEK_CATM = {}
let _catMapLoaded = false

async function loadCatMap() {
  try {
    const r = await fetch('/api/weknora/doc-category')
    if (r.ok) {
      const d = await r.json()
      if (d && d.map) { WEK_CATM = d.map || {}; _catMapLoaded = true; try { localStorage.setItem('weknora_catmap', JSON.stringify(WEK_CATM)) } catch (e) {}; return }
    }
  } catch (e) { /* 后端不可用，回退本地 */ }
  try { WEK_CATM = JSON.parse(localStorage.getItem('weknora_catmap') || '{}') || {} } catch (e) { WEK_CATM = {} }
  _catMapLoaded = true
}

function setDocCat(docId, catId) {
  if (catId) WEK_CATM[docId] = catId
  else delete WEK_CATM[docId]
  try { localStorage.setItem('weknora_catmap', JSON.stringify(WEK_CATM)) } catch (e) {}
  // 后端持久化（失败静默；localStorage 已兜底，恢复后下次写入补齐）
  try {
    fetch('/api/weknora/doc-category', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ docId, catId: catId || null }),
    }).catch(() => {})
  } catch (e) {}
}

function saveCatMap() { try { localStorage.setItem('weknora_catmap', JSON.stringify(WEK_CATM)) } catch (e) {} }
function catOfDoc(it) { return WEK.enabled ? (it.__kbName || it.knowledge_base_name || '') : ((store.kb.find(k => k.id === it.id) || {}).catId || null) }
function docsInCat(nodeId) {
  const src = WEK.enabled ? WEK.items : store.kb
  if (nodeId === 'all') return src
  if (WEK.enabled) return src.filter(it => (it.knowledge_base_id || it.__kbId) === nodeId)
  const ids = descIds(nodeId)
  return src.filter(it => { const c = catOfDoc(it); return c && ids.indexOf(c) >= 0 })
}

function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt)) return String(d).slice(0, 16)
  return dt.toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
}

async function loadWeKnoraKb(force) {
  if (WEK.loading) return
  if (!force && WEK.loadedAt && Date.now() - WEK.loadedAt < 30000) return
  WEK.loading = true
  WEK.error = ''
  try {
    /* 左侧列表 = WeKnora 真实知识库；配置里的 WEKNORA_KB_ID 可能属于别的租户（会 404），一律以可见列表为准 */
    let kbs = []
    try {
      const kr = await fetch('/api/weknora/kbs')
      const kj = await kr.json()
      kbs = (kj.data || []).map(x => ({ id: x.id, name: x.name, docs: x.knowledge_count != null ? x.knowledge_count : 0, desc: x.description || '' }))
    } catch (e) { kbs = [] }
    WEK.kbs = kbs
    const last = (function () { try { return localStorage.getItem('wek_kb') } catch (e) { return '' } })()
    const okSel = id => id === 'all' || kbs.some(k => k.id === id)
    const pick = okSel(WEK.kbId) ? WEK.kbId : (okSel(last) ? last : 'all')
    WEK.kbId = pick
    if (pick === 'all') {
      /* 全部：并发拉各库文档合并（库数个位数、单库上限 200 篇，代价可接受） */
      const groups = await Promise.all(kbs.map(k =>
        fetch('/api/weknora/knowledge?page=1&page_size=200&kb=' + encodeURIComponent(k.id))
          .then(r => r.json())
          .then(j => (j.data || []).map(x => Object.assign({ __kbName: k.name }, x)))
          .catch(() => [])))
      WEK.items = [].concat.apply([], groups)
      WEK.base = { name: '全部知识库', id: 'all' }
    } else {
      const q = '?kb=' + encodeURIComponent(pick)
      const [baseRes, listRes] = await Promise.all([
        fetch('/api/weknora/knowledge-base' + q),
        fetch('/api/weknora/knowledge?page=1&page_size=200' + q)
      ])
      const baseData = await baseRes.json()
      const listData = await listRes.json()
      WEK.base = baseData.data || (kbs.find(k => k.id === pick) || null)
      const kname = (WEK.base && WEK.base.name) || ''
      WEK.items = (listData.data || []).map(x => Object.assign({ __kbName: kname }, x))
      WEK.notice = (!baseData.data && !baseData.success) ? '配置的默认知识库对当前 API Key 不可见，已自动切到可见知识库' : ''
    }
    WEK.items.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
    WEK.enabled = true
  } catch (e) {
    WEK.error = String(e && e.message || e)
    WEK.enabled = false
  }
  WEK.loading = false
  WEK.loadedAt = Date.now()
  if (document.getElementById('p-kb') && document.getElementById('p-kb').classList.contains('on')) renderKb()
}
function kbPick(id) {
  WEK.kbId = id || 'all'
  try { localStorage.setItem('wek_kb', WEK.kbId) } catch (e) {}
  WEK.loadedAt = 0
  return loadWeKnoraKb(true)
}

function renderKb() {
  if (!document.getElementById('kbTree')) return
  if (WEK.enabled === null && !WEK.loading) loadWeKnoraKb()
  if (WEK.enabled) kbSelCat = WEK.kbId || 'all'
  renderKbTree()
  const el = document.getElementById('kbList')
  const crumb = document.getElementById('kbCrumb')

  let statusHtml = ''
  if (WEK.loading) statusHtml = '正在连接 WeKnora…'
  else if (WEK.error) statusHtml = `WeKnora 连接失败：${esc(WEK.error)}`
  else if (WEK.enabled) statusHtml = `${WEK.kbs.length} 个知识库 · ${WEK.items.length} 个文档 · 只读（可检索、预览、下载）`
  else statusHtml = '本地模拟向量库'
  crumb.innerHTML = `当前知识库：<b>${WEK.enabled ? esc((WEK.base && WEK.base.name) || '全部知识库') : esc(catName(kbSelCat))}</b> · ${statusHtml} · 本库 ${docsInCat(kbSelCat).length} 个文档` +
    (WEK.notice ? `<br><small style="color:#b25e0c">${esc(WEK.notice)}</small>` : '')

  if (WEK.loading && !WEK.items.length) { el.innerHTML = '<div class="empty">正在从 WeKnora 加载知识库文档…</div>'; return }
  if (WEK.error && !WEK.items.length) { el.innerHTML = `<div class="empty">WeKnora 加载失败<br><small>${esc(WEK.error)}</small><br><button class="btn sm" style="margin-top:10px" onclick="loadWeKnoraKb(true)">重试</button></div>`; return }

  const kw = (document.getElementById('kbSearch').value || '').toLowerCase().split(/\s+/).filter(Boolean)
  // 左侧选中的是 WeKnora 知识库；「全部知识库」= 不过滤
  let list = docsInCat(kbSelCat).slice()
  if (kw.length) list = list.filter(it => kw.some(w => ((it.title || '') + ' ' + (it.description || '') + ' ' + (it.file_name || '') + ' ' + (it.content || '')).toLowerCase().includes(w)))

  if (!list.length) {
    if (WEK.enabled && kbSelCat !== 'all' && !kw.length) {
      el.innerHTML = '<div class="empty">该知识库暂无文档<br><small>左侧点「全部知识库」可跨库查看；新增文档请到 WeKnora 管理端</small></div>'
    } else {
      el.innerHTML = '<div class="empty">没有匹配文档<br><small>本页为只读：可检索、预览、下载原文；如需增删文档请到 WeKnora 管理端</small></div>'
    }
    return
  }

  const showKbName = WEK.enabled && kbSelCat === 'all'
  el.innerHTML = list.map(it => {
    const status = it.parse_status || 'unknown'
    const statusTag = status === 'completed'
      ? '<span class="tag" style="background:#e6f4ea;color:var(--ok)">✔ 已解析</span>'
      : status === 'pending' || status === 'processing'
        ? '<span class="tag" style="background:#fff7e6;color:var(--warn)">⏳ 解析中</span>'
        : `<span class="tag" style="background:#ffebee;color:var(--danger)">⚠ ${esc(status)}</span>`
    const owner = it.knowledge_base_id || WEK.kbId || ''
    return `<div class="kb-item">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <b>${esc(it.title || it.file_name || '未命名')}</b>
        ${showKbName ? `<span class="tag" style="background:#eef3fd;color:#1c5ed8">${esc(it.__kbName || it.knowledge_base_name || '未知库')}</span>` : ''}
        <span class="tag">${esc((it.file_type || '未知').toUpperCase())}</span>
        <span class="tag">${fmtSize(it.file_size)}</span>
        ${statusTag}
        <span class="tag">${it.enable_status === 'enabled' ? '已启用' : '未启用'}</span>
        <div style="flex:1"></div>
        <button class="btn sm ghost" onclick="previewWekDoc('${it.id}')">预览</button>
        <a class="btn sm ghost" href="/api/weknora/download/${encodeURIComponent(it.id)}?kb=${encodeURIComponent(owner)}&name=${encodeURIComponent(it.file_name || it.title || 'file')}" target="_blank">下载</a>
      </div>
      <div class="meta">更新于 ${fmtDate(it.updated_at || it.created_at)} · ${esc(it.file_name || '')}</div>
      <div class="body">${esc((it.description || '').slice(0, 600))}${(it.description || '').length > 600 ? '…' : ''}</div>
    </div>`
  }).join('')
}

/* 覆盖 main.js 的 renderKbTree：左侧直接列出 WeKnora 的真实知识库（跟着 WeKnora 增删自动变化），
   连不上 WeKnora 时才回退到本地目录树。 */
function renderKbTree() {
  const treeEl = document.getElementById('kbTree')
  if (!treeEl) return
  if (!WEK.enabled) {
    function node(n, depth) {
      const kids = childrenOf(n.id)
      const cnt = docsInCat(n.id).length
      return `<div class="tnode ${kbSelCat === n.id ? 'on' : ''}" style="padding-left:${8 + depth * 14}px" onclick="kbSelCat='${n.id}';renderKb()">
        <span>📁 ${esc(n.name)}</span><b class="tc">${cnt}</b>
        <span class="tnode-ops"><button title="新建子目录" onclick="event.stopPropagation();addCatNode('${n.id}')">＋</button><button title="重命名" onclick="event.stopPropagation();renameCatNode('${n.id}')">✎</button><button title="删除" onclick="event.stopPropagation();delCatNode('${n.id}')">✕</button></span></div>` +
        kids.map(k => node(k, depth + 1)).join('')
    }
    treeEl.innerHTML =
      `<div class="tnode ${kbSelCat === 'all' ? 'on' : ''}" onclick="kbSelCat='all';renderKb()"><span>📚 全部知识</span><b class="tc">${docsInCat('all').length}</b></div>` +
      childrenOf(null).map(n => node(n, 0)).join('')
    return
  }
  const cntOf = id => WEK.items.filter(it => (it.knowledge_base_id || it.__kbId) === id).length
  treeEl.innerHTML =
    `<div class="tnode ${kbSelCat === 'all' ? 'on' : ''}" onclick="kbPick('all')"><span>📚 全部知识库</span><b class="tc">${WEK.items.length}</b></div>` +
    WEK.kbs.map(k => `<div class="tnode ${kbSelCat === k.id ? 'on' : ''}" title="${esc(k.desc || k.name)}" onclick="kbPick('${k.id}')">
      <span>🗂 ${esc(k.name)}</span><b class="tc">${cntOf(k.id) || k.docs || 0}</b></div>`).join('') +
    (WEK.kbs.length ? '' : '<div class="empty" style="padding:8px">没有可见的知识库</div>') +
    `<div class="hint" style="margin-top:8px">库列表实时取自 WeKnora；WeKnora 里新建或删除知识库，这里刷新后同步。</div>`
}

/* 覆盖 main.js 的 delCatNode：删除目录时同时清理 WeKnora 文档的目录归属 */
function delCatNode(id) {
  const n = store.kbTree.find(x => x.id === id)
  if (!n) return
  if (!confirm('删除目录「' + n.name + '」？\n子目录上提一层，目录内知识移至上级')) return
  const ids = descIds(id)
  // 清除该目录及子目录下文档的归属，并同步后端（setDocCat 会 PUT 后端 + 写 localStorage）
  Object.keys(WEK_CATM).filter(k => ids.indexOf(WEK_CATM[k]) >= 0).forEach(k => setDocCat(k, null))
  saveCatMap()
  childrenOf(id).forEach(k => k.pid = n.pid)
  store.kb.forEach(k => { if (k.catId === id) k.catId = n.pid || null })
  store.kbTree = store.kbTree.filter(x => x.id !== id)
  if (kbSelCat === id) kbSelCat = n.pid || 'all'
  persist(); renderKb()
}

function previewWekDoc(id) {
  const it = WEK.items.find(x => x.id === id)
  if (!it) return
  document.getElementById('docViewTitle').textContent = it.title || it.file_name || '文档预览'
  document.getElementById('docViewBody').innerHTML = `<div style="margin-bottom:12px">
    <span class="tag">${esc((it.file_type || '未知').toUpperCase())}</span>
    <span class="tag">${fmtSize(it.file_size)}</span>
    <span class="tag">${it.parse_status === 'completed' ? '已解析' : '解析中/待处理'}</span>
    <span class="tag">${it.enable_status === 'enabled' ? '已启用' : '未启用'}</span>
  </div><div style="white-space:pre-wrap">${esc(it.description || '暂无描述')}</div>`
  openMask('mDocView')
}

async function deleteWekDoc(id) {
  const it = WEK.items.find(x => x.id === id)
  if (!it) return
  if (!confirm(`确认从 WeKnora「${WEK.base && WEK.base.name || '售前工具箱'}」删除文档「${it.title || it.file_name}」？此操作不可恢复。`)) return
  try {
    const r = await fetch('/api/weknora/knowledge/' + encodeURIComponent(id), { method: 'DELETE' })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || ('删除失败（HTTP ' + r.status + ')'))
    }
    WEK.items = WEK.items.filter(x => x.id !== id)
    toast('已删除：' + (it.title || it.file_name))
    renderKb()
  } catch (e) {
    alert('删除失败：' + (e && e.message || e))
  }
}

/* ---- 四步向量化入库向导（真实上传到 WeKnora） ---- */
function openWizard() {
  wz = {
    files: [], step: 1, parse: 'precise', ext: { img: true, ocr: true, table: true },
    filterTxt: '', segMode: 'auto', segLen: 512, cur: 0,
    catId: kbSelCat !== 'all' ? kbSelCat : ((childrenOf(null)[0] || {}).id || ''),
    uploading: false, uploadResults: [], allDone: false, error: ''
  }
  renderWz(); openMask('mWizard')
}

function renderWz() {
  if (!wz) return
  const names = ['上传', '解析设置', '分段预览', '上传入库']
  document.getElementById('wzSteps').innerHTML = names.map((n, i) => {
    const s = i + 1
    return `<div class="ws ${s === wz.step ? 'on' : s < wz.step ? 'ok' : ''}"><i>${s < wz.step ? '✓' : s}</i>${n}</div>`
  }).join('')
  document.getElementById('wzBody').innerHTML = [wzS1, wzS2, wzS3, wzS4][wz.step - 1]()
  document.getElementById('wzPrevBtn').style.visibility = wz.step > 1 && wz.step < 4 ? 'visible' : 'hidden'
  const nb = document.getElementById('wzNextBtn')
  if (wz.step === 4) {
    nb.textContent = wz.allDone ? '完成' : (wz.uploading ? '上传中…' : '开始上传')
    nb.disabled = wz.uploading || (wz.allDone ? false : !wz.files.length)
  } else {
    nb.textContent = '下一步'
    nb.disabled = wz.step === 1 && !wz.files.length
  }
}

function wzS1() {
  return `<div class="drop" id="wzDrop" onclick="document.getElementById('wzFile').click()"
    ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')"
    ondrop="event.preventDefault();this.classList.remove('over');wzHandle(event.dataTransfer.files)">
    <span class="up">⬆</span>点击上传或拖拽文档到这里<br>
    <small>支持 PDF、TXT、DOC、DOCX、PPT、PPTX、XLS、XLSX、MD、JPG、PNG 等；文件将上传到 WeKnora「售前工具箱」知识库</small>
    <input type="file" id="wzFile" multiple style="display:none" onchange="wzHandle(this.files)"></div>
    <div style="margin-top:12px">${wz.files.map((f, i) => `<div class="kb-item" style="display:flex;align-items:center;gap:10px;padding:9px 12px"><span>${['📄', '📝', '📊', '📦'][Math.min(3, ['txt', 'md', 'csv', 'json'].includes(f.ext) ? 0 : ['doc', 'docx'].includes(f.ext) ? 1 : ['xls', 'xlsx'].includes(f.ext) ? 2 : 3)]}</span>
      <b style="flex:1">${esc(f.name)}</b><span class="tag">${fmtSize(f.size)}</span><span class="tag">${f.text ? f.text.length + ' 字符已提取' : (['txt', 'md', 'csv', 'json', 'log'].includes(f.ext) ? '读取中…' : '待 WeKnora 解析')}</span>
      <button class="btn sm danger" onclick="wz.files.splice(${i}, 1); renderWz()">✕</button></div>`).join('')}</div>`
}

function wzHandle(fl) {
  ;[...fl].forEach(file => {
    const ext = file.name.split('.').pop().toLowerCase()
    const item = { name: file.name, size: file.size, ext: ext, text: '', raw: file }
    wz.files.push(item)
    if (['txt', 'md', 'csv', 'json', 'log'].includes(ext)) {
      const r = new FileReader()
      r.onload = () => { item.text = r.result; renderWz() }
      r.readAsText(file, 'utf-8')
    }
  })
  renderWz()
}

function wzS2() {
  return `<div class="hint">📁 目标知识库：${WEK.enabled ? 'WeKnora「' + esc(WEK.base && WEK.base.name || '售前工具箱') + '」' : '（WeKnora 未连接，上传将失败）'}</div>
  <div style="font-weight:700;margin:14px 0 8px">入库目录</div>
  <select id="wzCat" onchange="wz.catId=this.value;toast('将归入：'+(this.value?catName(this.value):'全部知识（未归类）'))" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;font-size:13px">
    <option value="" ${wz.catId ? '' : 'selected'}>（不指定目录 · 归入「全部知识」，后续可在目录树归类）</option>
    ${store.kbTree.map(n => { let d = 0, p = n.pid; while (p) { d++; const q = store.kbTree.find(x => x.id === p); p = q ? q.pid : null } return `<option value="${n.id}" ${wz.catId === n.id ? 'selected' : ''}>${'　'.repeat(d)}${esc(n.name)}</option>` }).join('')}
  </select>
  <div style="font-weight:700;margin:14px 0 8px">文档解析策略</div>
  <div class="wz-opt ${wz.parse === 'precise' ? 'on' : ''}" onclick="wz.parse='precise';renderWz()"><b>精准解析</b><p>提取图片、表格、OCR 等元素，需要更长时间</p>
    ${wz.parse === 'precise' ? `<div style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px">
      <b style="font-size:12.5px">提取内容</b><br>
      <label style="font-size:12.5px"><input type="checkbox" style="width:auto" ${wz.ext.img ? 'checked' : ''} onchange="wz.ext.img=this.checked"> 图片元素（VLM）</label>&nbsp;
      <label style="font-size:12.5px"><input type="checkbox" style="width:auto" ${wz.ext.ocr ? 'checked' : ''} onchange="wz.ext.ocr=this.checked"> 扫描件（OCR）</label>&nbsp;
      <label style="font-size:12.5px"><input type="checkbox" style="width:auto" ${wz.ext.table ? 'checked' : ''} onchange="wz.ext.table=this.checked"> 表格元素</label></div>` : ''}
  </div>
  <div class="wz-opt ${wz.parse === 'fast' ? 'on' : ''}" onclick="wz.parse='fast';renderWz()"><b>快速解析</b><p>不提取图像、表格等元素，适用于纯文本，速度更快</p></div>
  <div style="font-weight:700;margin:14px 0 8px">分段策略</div>
  <div class="wz-opt ${wz.segMode === 'auto' ? 'on' : ''}" onclick="wz.segMode='auto';renderWz()"><b>自动分段与清洗</b><p>按语义自动分段，约 ${wz.segLen} 字/段</p></div>
  <div class="wz-opt ${wz.segMode === 'custom' ? 'on' : ''}" onclick="wz.segMode='custom';renderWz()"><b>固定长度</b><p>按固定长度切分</p>
    ${wz.segMode === 'custom' ? `<div style="margin-top:8px">分段长度：<input type="number" value="${wz.segLen}" style="width:100px" onchange="wz.segLen=+this.value||512"> 字符</div>` : ''}</div>
  <div class="wz-opt ${wz.segMode === 'hier' ? 'on' : ''}" onclick="wz.segMode='hier';renderWz()"><b>按层级分段</b><p>按 #标题 / 第X章 / 1.2 编号等层级结构分段</p></div>
  <div style="margin-top:12px"><b>分段重叠长度</b> <input type="number" id="wzOverlap" value="80" style="width:80px"> 字符 <small style="color:var(--sub)">（相邻分段重复字数，帮助保持上下文）</small></div>`
}

function wzSplit(f) {
  let txt = f.text
  if (!txt) return ['（该文件未在本地提取文本，上传后由 WeKnora 自动解析并分段）']
  txt = txt.replace(/\r/g, '')
  if (wz.filterTxt) { try { txt = txt.replace(new RegExp(wz.filterTxt, 'g'), '') } catch (e) { toast('过滤正则有误，已忽略') } }
  const len = Math.max(100, +wz.segLen || 512)
  let parts
  if (wz.segMode === 'hier') parts = txt.split(/(?=^(?:#{1,4}\s|第[一二三四五六七八九十百0-9]+[章节部分篇]|[0-9]+(?:\.[0-9]+)*\s))/m)
  else if (wz.segMode === 'custom') { parts = []; for (let i = 0; i < txt.length; i += len) parts.push(txt.slice(i, i + len)) }
  else parts = txt.split(/\n{2,}|(?<=[。；])\n/)
  let out = []
  parts.filter(p => p && p.trim()).forEach(p => {
    if (wz.segMode !== 'custom' && p.length > len * 1.4) { for (let i = 0; i < p.length; i += len) out.push(p.slice(i, i + len).trim()) }
    else out.push(p.trim())
  })
  return out.filter(Boolean).slice(0, 500)
}

function wzS3() {
  if (wz.cur >= wz.files.length) wz.cur = 0
  const f = wz.files[wz.cur]
  const segs = f ? wzSplit(f) : []
  return `<div class="wz3">
    <div><h4>文档列表</h4>${wz.files.map((x, i) => `<div class="pnode ${i === wz.cur ? 'on' : ''}" onclick="wz.cur=${i};renderWz()">${esc(x.name)}</div>`).join('')}</div>
    <div><h4>原始文档预览</h4><div style="font-size:12.5px;line-height:1.8;white-space:pre-wrap">${esc(f ? (f.text ? f.text.slice(0, 3000) + (f.text.length > 3000 ? '\n…（截断预览）' : '') : '（未在本地提取文本，上传后由 WeKnora 解析）') : '—')}</div></div>
    <div><h4>分段预览 · ${segs.length} 段（${{ auto: '自动分段与清洗', custom: '固定长度', hier: '按层级分段' }[wz.segMode]}）</h4>
      ${segs.slice(0, 60).map((s, i) => `<div class="seg-card"><b>分段 ${i + 1} · ${s.length} 字</b><br>${esc(s.slice(0, 160))}${s.length > 160 ? '…' : ''}</div>`).join('') || '<div class="empty">无分段</div>'}${segs.length > 60 ? '<div class="empty">仅预览前 60 段</div>' : ''}</div>
  </div>`
}

function wzS4() {
  if (wz.uploading) {
    return `<div style="font-weight:700;margin-bottom:10px">正在上传到 WeKnora…</div>
      ${wz.files.map(f => `<div class="kb-item" style="padding:12px"><div style="display:flex;align-items:center;gap:10px"><span>📄</span><b style="flex:1">${esc(f.name)}</b></div>
      <div class="pbar"><i style="width:${f.p || 0}%"></i></div></div>`).join('')}`
  }
  if (wz.allDone) {
    return `<div style="font-weight:700;margin-bottom:10px">上传结果</div>
      ${wz.uploadResults.map(r => `<div class="kb-item" style="padding:12px;display:flex;align-items:center;gap:10px">
        <span>${r.ok ? '✔' : '✕'}</span>
        <b style="flex:1">${esc(r.name)}</b>
        <span style="color:${r.ok ? 'var(--ok)' : 'var(--danger)'}">${r.ok ? '上传成功' : esc(r.error || '失败')}</span>
      </div>`).join('')}
      <div class="hint" style="margin-top:12px;background:#e6f4ea;color:var(--ok)">已提交到 WeKnora 后台解析，解析完成后会自动出现在知识库列表中</div>`
  }
  return `<div style="font-weight:700;margin-bottom:10px">准备上传</div>
    <div class="hint">即将把 ${wz.files.length} 个文件上传到 WeKnora「${esc(WEK.base && WEK.base.name || '售前工具箱')}」知识库，并应用上一步配置的解析参数</div>
    ${wz.files.map(f => `<div class="kb-item" style="padding:10px 12px">📄 ${esc(f.name)} · ${fmtSize(f.size)}</div>`).join('')}`
}

function wzPrev() { if (wz.step > 1) { wz.step--; renderWz() } }

function wzNext() {
  if (wz.step === 1 && !wz.files.length) { toast('请先上传至少一个文件'); return }
  if (wz.step < 3) { wz.step++; renderWz(); return }
  if (wz.step === 3) { wz.step++; renderWz(); return }
  if (wz.step === 4) {
    if (wz.allDone) { wz = null; closeMask('mWizard'); toast('上传完成'); return }
    if (wz.uploading) return
    wzUploadAll()
  }
}

function buildProcessConfig() {
  const overlap = Math.max(0, Math.min(512, +(document.getElementById('wzOverlap') && document.getElementById('wzOverlap').value) || 80))
  return {
    chunking_config: {
      strategy: wz.segMode === 'custom' ? 'fixed' : wz.segMode === 'hier' ? 'hierarchical' : 'auto',
      chunk_size: Math.max(100, +wz.segLen || 512),
      chunk_overlap: overlap,
      separators: ['\n\n', '\n', '。', '！', '？', ';', '；'],
      child_chunk_size: 384,
      parent_chunk_size: 4096,
      enable_parent_child: true
    },
    parser_engine_rules: [
      { engine: 'builtin', file_types: ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'md', 'markdown', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp'] },
      { engine: 'markitdown', file_types: ['pptx', 'ppt'] },
      { engine: 'simple', file_types: ['csv', 'txt', 'json', 'log'] }
    ],
    vlm_config: { enabled: !!(wz.ext && wz.ext.img && wz.parse === 'precise'), model_id: '' },
    asr_config: { enabled: false },
    extract_config: { enabled: false },
    graph_enabled: false,
    enable_multimodel: !!(wz.ext && wz.ext.table && wz.parse === 'precise')
  }
}

async function wzUploadAll() {
  wz.uploading = true
  wz.uploadResults = []
  wz.files.forEach(f => f.p = 0)
  renderWz()
  const cfg = JSON.stringify(buildProcessConfig())
  for (let i = 0; i < wz.files.length; i++) {
    const f = wz.files[i]
    const form = new FormData()
    form.append('file', f.raw)
    form.append('process_config', cfg)
    try {
      const r = await fetch('/api/weknora/upload', { method: 'POST', body: form })
      const data = await r.json()
      f.p = 100
      // 抓取新建文档 id，归入所选目录（WeKnora 文档本身无目录概念，目录为前端本地归属）
      const newId = (data && data.data && (data.data.id || data.data.knowledge_id)) || (data && data.id) || null
      if (newId) { setDocCat(newId, wz.catId || null) }
      wz.uploadResults.push({ name: f.name, ok: data.success === true, error: data.success === true ? '' : (data.error && data.error.message || data.message || '上传失败') })
    } catch (e) {
      f.p = 100
      wz.uploadResults.push({ name: f.name, ok: false, error: String(e && e.message || e) })
    }
    renderWz()
  }
  wz.uploading = false
  wz.allDone = true
  renderWz()
  loadWeKnoraKb(true)
}

function wzFinish() { }
