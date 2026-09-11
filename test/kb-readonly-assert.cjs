/* 向量知识库页（只读 + 左侧库列表）离线断言
 * 用法（容器内，工作目录为仓库根）：node test/kb-readonly-assert.cjs
 * 用假 fetch 模拟 WeKnora 的 5 个知识库，验证：库列表实时渲染、全部视图跨库合并、
 * 按库过滤、所属库标签、下载链接带正确 kb、切换库后重新加载。 */
const fs = require('fs')
const main = fs.readFileSync('frontend/src/main.js', 'utf8')
const wek = fs.readFileSync('frontend/src/kb-weknora.js', 'utf8')
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b); if (i < 0 || j < 0 || j <= i) throw new Error('标记定位失败: ' + a); return src.slice(i, j) }

let pass = 0, fail = 0
const T = (name, cond, detail) => { if (cond) { pass++; console.log('PASS ' + name + (detail !== undefined ? '  [' + detail + ']' : '')) } else { fail++; console.log('FAIL ' + name + (detail !== undefined ? '  [' + detail + ']' : '')) } }

const KBS = [
  { id: 'kb-his', name: '历史方案与案例库', knowledge_count: 0 },
  { id: 'kb-prod', name: '产品与技术库', knowledge_count: 1 },
  { id: 'kb-team', name: '团队与简历库', knowledge_count: 1 },
  { id: 'kb-qua', name: '资质与荣誉库', knowledge_count: 6 },
  { id: 'kb-qa', name: '问答知识库', knowledge_count: 0 },
]
const DOCS = {
  'kb-prod': [{ id: 'd1', knowledge_base_id: 'kb-prod', title: '项目实施方案.docx', file_name: '项目实施方案.docx', file_type: 'docx', file_size: 1107202, parse_status: 'completed', enable_status: 'enabled', updated_at: '2026-09-06T09:30:01Z', description: '双活与异地灾备实施' }],
  'kb-team': [{ id: 'd2', knowledge_base_id: 'kb-team', title: '简历-张三.md', file_name: '简历-张三.md', file_type: 'md', file_size: 2048, parse_status: 'completed', enable_status: 'enabled', updated_at: '2026-09-05T09:00:00Z', description: '' }],
  'kb-qua': ['CMMI5', 'ISO9001', 'ISO20000', 'ISO27001', 'ISO14001', '软著'].map((n, i) => ({ id: 'q' + i, knowledge_base_id: 'kb-qua', title: n + '.png', file_name: n + '.png', file_type: 'png', file_size: 10000 + i, parse_status: 'completed', enable_status: 'enabled', updated_at: '2026-09-0' + (1 + i) + 'T09:00:00Z', description: n })),
  'kb-his': [], 'kb-qa': [],
}
let calls = []
const fetchStub = url => {
  calls.push(url)
  const u = String(url)
  const body = u.includes('/api/weknora/kbs') ? { data: KBS }
    : u.includes('/api/weknora/knowledge-base') ? { data: { id: (u.match(/kb=([^&]+)/) || [])[1], name: (KBS.find(k => k.id === (u.match(/kb=([^&]+)/) || [])[1]) || {}).name } }
      : u.includes('/api/weknora/knowledge') ? { data: DOCS[(u.match(/kb=([^&]+)/) || [])[1]] || [] }
        : u.includes('/api/weknora/doc-category') ? { map: {} } : { data: [] }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

const els = {}
const document = {
  getElementById: id => (els[id] = els[id] || {
    innerHTML: '', value: '', checked: false, style: {}, options: [], disabled: false, textContent: '', scrollTop: 0, scrollHeight: 0,
    appendChild() { }, addEventListener() { }, classList: { contains: () => false, toggle() { }, add() { }, remove() { } },
  }),
  querySelector: () => null, querySelectorAll: () => [], addEventListener() { }, hidden: false,
}
const lsStore = {}
const localStorage = { getItem: k => (k in lsStore ? lsStore[k] : null), setItem: (k, v) => { lsStore[k] = String(v) }, removeItem: k => { delete lsStore[k] } }

const code = cut(main, '/* ================= 数据层', '/* ================= C139 模型') +
  cut(main, '/* ================= C139 模型', '/* ================= 项目管理') +
  cut(main, '/* ================= 向量知识库', '/* ================= 项目知识库') +
  '\nfunction schedulePush(){}\n' +
  '\nfunction fmtSize(b){return !b?"—":b>1048576?(b/1048576).toFixed(1)+" MB":b>1024?(b/1024).toFixed(0)+" KB":b+" B"}\n' + wek

const boot = new Function('document', 'localStorage', 'fetch', 'window', code + `
  return {api:{loadWeKnoraKb,kbPick,renderKb,renderKbTree,docsInCat,get WEK(){return WEK},get kbSelCat(){return kbSelCat}}}`)
const H = boot(document, localStorage, fetchStub, {}).api

;(async () => {
  await H.loadWeKnoraKb(true)
  T('库列表取自 WeKnora（5 个）', H.WEK.kbs.length === 5, H.WEK.kbs.map(k => k.name).join('/'))
  T('默认落在「全部知识库」', H.WEK.kbId === 'all', H.WEK.kbId)
  T('全部视图跨库合并文档数=8', H.WEK.items.length === 8, H.WEK.items.length)
  H.renderKbTree()
  const tree = document.getElementById('kbTree').innerHTML
  T('左侧渲染出「全部知识库」+ 5 个库', (tree.match(/tnode/g) || []).length === 6, (tree.match(/tnode/g) || []).length)
  T('左侧显示每个库的真实名称', ['历史方案与案例库', '产品与技术库', '团队与简历库', '资质与荣誉库', '问答知识库'].every(n => tree.includes(n)))
  T('左侧显示文档数（资质库 6）', tree.includes('资质与荣誉库</span><b class="tc">6</b>'), (tree.match(/资质与荣誉库[\s\S]{0,48}/) || [''])[0].replace(/\s+/g, ' '))
  T('左侧不再有本地目录/新建目录按钮', !tree.includes('📁') && !tree.includes('新建根目录'))
  T('左侧提示库列表实时取自 WeKnora', tree.includes('实时取自 WeKnora'))
  H.renderKb()
  const list = document.getElementById('kbList').innerHTML
  T('全部视图下每条文档带所属库标签', list.includes('产品与技术库') && list.includes('资质与荣誉库'))
  T('文档行不再有目录归类下拉', !list.includes('归类到目录'))
  T('下载链接带上该文档所属库', /\/api\/weknora\/download\/d1\?kb=kb-prod/.test(list), (list.match(/download\/d1[^"]*/) || [''])[0])
  T('面包屑显示当前库与统计', document.getElementById('kbCrumb').innerHTML.includes('全部知识库') && document.getElementById('kbCrumb').innerHTML.includes('8 个文档'))

  await H.kbPick('kb-qua')
  T('切库后重新拉取（走了 kb=kb-qua）', calls.some(c => c.includes('/api/weknora/knowledge?') && c.includes('kb=kb-qua')))
  T('单库视图只剩该库 6 篇', H.WEK.items.length === 6 && H.docsInCat('kb-qua').length === 6, H.WEK.items.length)
  H.renderKb()
  const one = document.getElementById('kbList').innerHTML
  T('单库视图不再重复显示所属库标签', !one.includes('background:#eef3fd;color:#1c5ed8">资质'))
  T('单库下载链接 kb 参数正确', one.includes('kb=kb-qua'))
  T('记住上次选择的库', lsStore.wek_kb === 'kb-qua', lsStore.wek_kb)
  await H.kbPick('all')
  T('切回全部恢复 8 篇', H.WEK.items.length === 8, H.WEK.items.length)
  console.log('\n合计：' + pass + ' 通过 / ' + fail + ' 失败')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.log('FAIL 异常: ' + ((e && e.stack) || e)); process.exit(1) })
