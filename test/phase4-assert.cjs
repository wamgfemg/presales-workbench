/* 离线断言：项目管理排序/筛选、报价版本与成本红线、合同回款计划、干系人九宫格、竞争情报对位
 * 用法（容器内）：node test/phase4-assert.cjs frontend/src/main.js
 * 只读源码 + 桩 DOM，不访问网络、不写库。 */
const fs = require('fs')
const SRC = 'frontend/src/main.js'
const src = fs.readFileSync(process.argv[2] || SRC, 'utf8')
let pass = 0, fail = 0
const T = (name, cond, detail) => { if (cond) { pass++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  [' + detail + ']' : '')) } else { fail++; console.log('FAIL ' + name + (detail !== undefined ? '  [' + detail + ']' : '')) } }
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b); if (i < 0 || j < 0 || j <= i) { throw new Error('标记定位失败: ' + a) } return src.slice(i, j) }

const TODAY = '2026-09-09'
const els = {}
const defaults = { projStageFilter: 'all', projOppFilter: 'all', projOwnerFilter: '', projWarnFilter: '', ciProjFilter: '', ctProj: 'p3', qtProj: 'p1', stkProj: 'p1' }
const document = {
  getElementById: id => (els[id] = els[id] || {
    innerHTML: '', value: defaults[id] !== undefined ? defaults[id] : '', options: [],
    appendChild() { }, addEventListener() { }, style: {},
    classList: { contains: () => false, toggle() { }, add() { }, remove() { } }
  }),
  querySelector: () => null, querySelectorAll: () => [], addEventListener() { }, hidden: false
}
const localStorage = { getItem: () => null, setItem() { }, removeItem() { } }

/* 组装被测代码：数据层 + C139 + 项目管理 + 二期 + 干系人(含决策链) + 合同 + 报价 + 竞争情报 + 种子 */
const code =
  cut('/* ================= 数据层', '/* ================= C139 模型') +
  cut('/* ================= C139 模型', '/* ================= 项目管理') +
  cut('/* ================= 路由', '/* ================= 项目管理') +
  cut('/* ================= 项目管理', '/* ================= 项目详情') +
  cut('/* ================= 项目详情', '/* ================= 向量知识库') +
  cut('/* ================= 商机投入决策', '/* ================= 仪表盘') +
  cut('/* ================= 仪表盘', '/* ================= 二期：跟进记录') +
  cut('/* ================= 二期：跟进记录', '/* ================= 数据备份') +
  cut('/* ================= 干系人管理', '/* ================= 合同管理') +
  cut('/* ================= 合同管理', '/* ================= 报价管理') +
  cut('/* ================= 报价管理', '/* ================= 竞争情报') +
  cut('/* ================= 通用页面项目选择器', '/* ================= 干系人管理') +
  cut('/* ================= 竞争情报', 'function openCiModal') +
  cut('function seed(){', '/* ================= 服务端落库同步') +
  '\nfunction schedulePush(){}\n'

const boot = new Function('document', 'localStorage', 'window', 'fixedToday', code + `
  today=()=>fixedToday;
  seed();
  return {store, renderProjects, renderStakeholders, renderContracts, renderQuotations, renderCompintel, renderChain,
    parseTerms, ensurePayments, projVal, chainCoverage, sumQtCost, sumQtQuote, projHasWarn, projYearOf, projectsInView,
    goScore, goWeights, goSummary, goParseJson, goPrompt, renderDtGo, DEFAULTS: GO_WEIGHTS_DEFAULT,
    renderDash, pfSet, goProjects, setFyYear, inYear, getPF: () => PF, getSort: () => projSort,
    setSort:(k,d)=>{projSort.k=k;projSort.d=d}, _q:new Set()}
`)
const H = boot(document, localStorage, {}, TODAY)
const store = H.store

console.log('--- 种子装载：' + store.projects.length + ' 个项目 / ' + Object.keys(store.stakeholders).length + ' 个项目有关键人 ---')

/* ---- 1. 项目管理：排序与筛选 ---- */
T('阶段按业务顺序而非字母序', H.projVal({ stage: '招投标阶段' }, 'stage') > H.projVal({ stage: '方案阶段' }, 'stage'))
T('金额取数正确（p1 预估 860）', H.projVal(store.projects.find(p => p.id === 'p1'), 'est') === 860)
T('年度取实际签约月（p3 已签 2026-08 → 2026）', H.projYearOf(store.projects.find(p => p.id === 'p3')) === '2026', H.projYearOf(store.projects.find(p => p.id === 'p3')))
T('年度取预计签约月（p4 2027-03 → 2027）', H.projYearOf(store.projects.find(p => p.id === 'p4')) === '2027')
H.setSort('est', -1)
els.projTable = undefined; document.getElementById('projTable').innerHTML = ''
H.renderProjects()
const html0 = document.getElementById('projTable').innerHTML
const rowsOf = html => (html.match(/<tr>/g) || []).length - 1   // 减去表头行
T('渲染全部 6 个项目', rowsOf(html0) === 6, rowsOf(html0))
T('降序表头显示 ▼', html0.includes('▼'))
T('12 个可排序表头（含年度/加权/投入建议）', (html0.match(/class="sortable/g) || []).length === 12, (html0.match(/class="sortable/g) || []).length)
T('列表含加权金额列', html0.includes('加权(万)'))
T('命中统计行显示条件与合计', document.getElementById('projCount').innerHTML.includes('共') && document.getElementById('projCount').innerHTML.includes('预估合计'))
const firstData = html0.slice(html0.indexOf('</tr>') + 5)
T('预估额降序后首位是 860 万的项目', /860/.test(firstData.slice(0, 700)), firstData.slice(0, 60).replace(/\s+/g, ' '))
H.pfSet('warn', 'warn')
T('pfSet 后预警筛选命中 2 个项目（p1 逾期 / p2 高风险）', rowsOf(document.getElementById('projTable').innerHTML) === 2, rowsOf(document.getElementById('projTable').innerHTML))
H.pfSet('warn', 'over')
T('只看逾期下一步命中 1 个（p1）', rowsOf(document.getElementById('projTable').innerHTML) === 1)
H.pfSet('warn', 'risk')
T('只看高风险命中 2 个（p1、p2 各有高风险未关闭）', rowsOf(document.getElementById('projTable').innerHTML) === 2, rowsOf(document.getElementById('projTable').innerHTML))
H.pfSet('warn', '')
H.pfSet('opp', '博弈')
T('按商机级别=博弈 命中 2 个项目（p2 + p5）', rowsOf(document.getElementById('projTable').innerHTML) === 2)
H.pfSet('opp', 'all')
H.pfSet('stage', '已中标')
T('按阶段=已中标 命中 1 个项目', rowsOf(document.getElementById('projTable').innerHTML) === 1)
H.pfSet('stage', 'all')
H.pfSet('range', 'active')
T('范围=在跟 命中 3 个项目', rowsOf(document.getElementById('projTable').innerHTML) === 3, rowsOf(document.getElementById('projTable').innerHTML))
H.pfSet('range', 'closed')
T('范围=已收口 命中 3 个项目（中标1+输标1+取消1）', rowsOf(document.getElementById('projTable').innerHTML) === 3)
H.pfSet('range', 'all')
T('负责人下拉动态生成', (document.getElementById('projOwnerFilter').innerHTML.match(/<option>/g) || []).length >= 5,
  (document.getElementById('projOwnerFilter').innerHTML.match(/<option>/g) || []).length + ' 人')

/* ---- 1b. 年度口径与首页下钻 ---- */
H.setFyYear('2027')
T('切到 2027 年只剩 1 个在跟项目', H.projectsInView().length === 1, H.projectsInView().length)
H.renderProjects()
T('项目列表跟随年度只剩 1 行', rowsOf(document.getElementById('projTable').innerHTML) === 1)
H.setFyYear('2026')
T('切到 2026 年有 5 个项目', H.projectsInView().length === 5, H.projectsInView().length)
H.setFyYear('all')
els.dashKpis = undefined; document.getElementById('dashKpis').innerHTML = ''
document.getElementById('dashFunnel').innerHTML = ''
H.renderDash()
const kpiHtml = document.getElementById('dashKpis').innerHTML
T('9 张指标卡全部可点击', (kpiHtml.match(/kpi clickable/g) || []).length === 9, (kpiHtml.match(/kpi clickable/g) || []).length)
T('指标卡带 goProjects 跳转参数', kpiHtml.includes("goProjects({&quot;") || kpiHtml.includes('goProjects({"range":"active"'), kpiHtml.slice(kpiHtml.indexOf('onclick'), kpiHtml.indexOf('onclick') + 60))
T('指标卡显示当前年度口径', kpiHtml.includes('全部年度'))
const fn = document.getElementById('dashFunnel').innerHTML
T('漏斗 7 个阶段均可点击', (fn.match(/funnel-row clickable/g) || []).length === 7, (fn.match(/funnel-row clickable/g) || []).length)
T('商机级别标签可点击下钻', fn.includes('tag clickable'))
H.goProjects({ range: 'won', sort: 'profit' })
T('goProjects 写入范围条件', H.getPF().range === 'won')
T('goProjects 写入排序键与方向', H.getSort().k === 'profit' && H.getSort().d === -1)
H.renderProjects()
T('按毛利排序后首位是中标项目', /某市政务云二期/.test(document.getElementById('projTable').innerHTML.slice(0, 1200)))
H.goProjects({})
T('重置筛选回到默认', H.getPF().range === 'all' && H.getPF().warn === '' && H.getSort().k === '')

/* ---- 2. 报价 ---- */
document.getElementById('qtBody').innerHTML = ''
H.renderQuotations()
const qt = document.getElementById('qtBody').innerHTML
T('V2 报价合计 810 万', Math.round(H.sumQtQuote(store.quotations.p1[0])) === 810, H.sumQtQuote(store.quotations.p1[0]))
T('V2 成本合计 560 万', Math.round(H.sumQtCost(store.quotations.p1[0])) === 560, H.sumQtCost(store.quotations.p1[0]))
T('成本红线告警（560 > 预算 520）', qt.includes('已超项目成本预算'))
T('与上一版差额 +70 万 / +7pt', qt.includes('报价 +70') && qt.includes('利润率 +7pt'))
T('价格空间提示（860-810=50）', qt.includes('价格空间 50'))
T('状态可流转（含中标价）', qt.includes('中标价</option>'))

/* ---- 3. 合同回款 ---- */
T('parseTerms 解析 3:6:1', JSON.stringify(H.parseTerms('3:6:1').map(x => x.ratio)) === '[30,60,10]', JSON.stringify(H.parseTerms('3:6:1').map(x => x.ratio)))
T('parseTerms 解析含文字条款', JSON.stringify(H.parseTerms('预付30%、到货60%、质保10%').map(x => x.ratio)) === '[30,60,10]')
T('parseTerms 无数字时返回空', H.parseTerms('验收后一次性付清').length === 0)
const cc = { paymentTerms: '3:6:1' }
const plan = H.ensurePayments(cc, 796)
T('回款金额分摊且合计=合同额', Math.round(plan.reduce((s, x) => s + x.amount, 0) * 10) / 10 === 796, plan.map(x => x.amount).join('+'))
cc.payments[1].paid = true; cc.payments[1].paidDate = '2026-09-01'
H.ensurePayments(cc, 796)
T('重算保留已标记的回款', cc.payments[1].paid === true && cc.payments[1].paidDate === '2026-09-01')
document.getElementById('ctBody').innerHTML = ''
H.renderContracts()
const ct = document.getElementById('ctBody').innerHTML
T('合同页显示逾期回款提醒', ct.includes('期回款已逾期'))
T('合同页显示回款率 30%', ct.includes('回款率 30%'))
T('合同页显示交付倒计时 24 天', ct.includes('距交付/到期日 24 天'), (ct.match(/距交付\/到期日 \d+ 天/) || []).join())
T('合同状态下拉含已结清', ct.includes('已结清'))

/* ---- 4. 干系人矩阵 / 决策链 / 竞争情报 ---- */
document.getElementById('stkBody').innerHTML = ''
H.renderStakeholders()
const stk = document.getElementById('stkBody').innerHTML
T('p1 必备角色已覆盖 4/4', stk.includes('必备角色已覆盖 4/4'))
T('p1 有教练，不出现教练告警', !stk.includes('尚无教练'))
T('矩阵含「未知」立场列', stk.includes('未知'))
document.getElementById('stkProj').value = 'p2'
document.getElementById('stkBody').innerHTML = ''
H.renderStakeholders()
const stk2 = document.getElementById('stkBody').innerHTML
T('p2 提示缺三个必备角色', stk2.includes('必备角色缺：决策者、最终审批人、采购负责人'))
T('p2 提示无教练且给出 50% 上限', stk2.includes('尚无教练/内线') && stk2.includes('50%'))
document.getElementById('chainBody').innerHTML = ''
H.renderChain()
T('决策链页正常渲染', document.getElementById('chainBody').innerHTML.length > 3000, document.getElementById('chainBody').innerHTML.length)
document.getElementById('ciProjFilter').value = 'p1'
document.getElementById('ciBody').innerHTML = ''
H.renderCompintel()
const ci = document.getElementById('ciBody').innerHTML
T('选定项目后只渲染该项目对位卡', ci.includes('报价对位') && !ci.includes('青海银行信贷'))
T('算出对手比我方低 24.7%', ci.includes('比我方低 24.7%'), (ci.match(/比我方低 [\d.]+%/) || []).join())
T('价格劣势时给出不降价建议', ci.includes('慎用降价'))
document.getElementById('ciProjFilter').value = ''
document.getElementById('ciBody').innerHTML = ''
H.renderCompintel()
T('全部项目视图显示对手画像', document.getElementById('ciBody').innerHTML.includes('对手画像'))

/* ---- 5. 商机投入决策 GO / NO-GO ---- */
const g1 = H.goScore(store.projects.find(p => p.id === 'p1'))
const g4 = H.goScore(store.projects.find(p => p.id === 'p4'))
const g2 = H.goScore(store.projects.find(p => p.id === 'p2'))
T('默认权重为 30/20/12/15/15/8', JSON.stringify(H.goWeights()) === JSON.stringify(H.DEFAULTS), JSON.stringify(H.goWeights()))
T('六维得分齐全', ['win', 'rel', 'comm', 'comp', 'value', 'health'].every(k => typeof g1.dims[k] === 'number'), JSON.stringify(g1.dims))
T('p1（控单+全角色+教练+对手情报）GO 分高于 p4', g1.score > g4.score, g1.score + ' vs ' + g4.score)
T('p1 判为「重点投入」', g1.tier === 'must', g1.score + ' ' + g1.tierLabel)
T('p4 因缺信息归入「数据不足」而不是放弃', g4.tier === 'data' && g4.missing.length >= 3, g4.missing.join('/'))
T('p2 触发「自称控单」以外的背离或高风险提示', g2.flags.length > 0 || g2.missing.length > 0, g2.flags.join('/') + ' | ' + g2.missing.join('/'))
store.ui = { weights: { win: 100, rel: 0, comm: 0, comp: 0, value: 0, health: 0 } }
const g1w = H.goScore(store.projects.find(p => p.id === 'p1'))
T('权重覆盖生效（其余置 0 → 总分等于赢面分）', g1w.score === g1w.dims.win, g1w.score + ' vs win=' + g1w.dims.win)
T('显式置 0 是合法覆盖（该维度不再计入）', H.goWeights().rel === 0 && g1w.score === g1w.dims.win, JSON.stringify(H.goWeights()))
store.ui = { weights: { win: 55 } }
T('未提供的维度回退默认权重', H.goWeights().rel === H.DEFAULTS.rel && H.goWeights().win === 55, JSON.stringify(H.goWeights()))
store.ui = {}
const fake = Object.assign({}, store.projects.find(p => p.id === 'p1'))
fake.oppLevel = '控单'; fake.c139 = { is1W: false, coach: false, consensus: [false, false, false], factors: [true, true, false, false, false, false, false, false, false], note: '' }
T('背离检测：自称控单但 C139 低分被点名', H.goScore(fake).flags.some(f => f.includes('自称控单')), H.goScore(fake).flags.join('/'))
const parsed = H.goParseJson('结论如下： {"score": 62, "verdict": "谨慎GO", "reasons": ["a","b"], "gaps": ["c"], "action": "先补预算"} 以上')
T('AI 返回带杂文本仍能解析出 JSON', !!parsed && parsed.score === 62 && parsed.verdict === '谨慎GO', JSON.stringify(parsed))
T('AI 返回非 JSON 时安全返回 null', H.goParseJson('我需要更多信息才能判断') === null)
const prompt = H.goPrompt(fake, H.goScore(fake))
T('提示词含六维与权重', prompt.includes('六维指标') && prompt.includes('"win":30'))
T('提示词含成本毛利（已获授权外发）', prompt.includes('成本') && prompt.includes('毛利率'))
T('提示词要求只输出一行 JSON', prompt.includes('只输出一行 JSON'))
T('提示词要求缺信息不直接判 NO-GO', prompt.includes('不要直接判 NO-GO'))
const sum = H.goSummary(H.projectsInView().filter(p => p.stage !== '已中标' && !['已流标', '已输标', '项目已取消'].includes(p.stage)))
T('小盘汇总四档计数之和=在跟项目数', sum.must + sum.watch + sum.drop + sum.data === 3, JSON.stringify(sum))
document.getElementById('dashGoSummary').innerHTML = ''
document.getElementById('dashGo').innerHTML = ''
document.getElementById('dashNoGo').innerHTML = ''
H.renderDash()
const goHtml = document.getElementById('dashGo').innerHTML
T('GO 榜渲染出项目行与 AI 复核按钮', goHtml.includes('AI 复核') && goHtml.includes('dimbar'), goHtml.length)
T('小盘汇总渲染出四档与权重按钮', document.getElementById('dashGoSummary').innerHTML.includes('重点投入') && document.getElementById('dashGoSummary').innerHTML.includes('权重设置'))
T('NO-GO 榜渲染', document.getElementById('dashNoGo').innerHTML.length > 100)
H.goProjects({ go: 'data' })
T('goProjects 带上投入建议条件', H.getPF().go === 'data')
H.renderProjects()
T('按「数据不足」筛出 3 个项目（清单含已收口项目，口径比小盘宽）', rowsOf(document.getElementById('projTable').innerHTML) === 3, rowsOf(document.getElementById('projTable').innerHTML))
T('清单出现投入建议列', document.getElementById('projTable').innerHTML.includes('投入建议'))
H.goProjects({})
document.getElementById('dtBody').innerHTML = ''
const dtGo = H.renderDtGo(store.projects.find(p => p.id === 'p1'))
T('详情投入决策 Tab 渲染六维表', (dtGo.match(/<tr>/g) || []).length >= 7 && dtGo.includes('推进健康度'), (dtGo.match(/<tr>/g) || []).length)
T('详情 Tab 含数据缺口与免责说明', dtGo.includes('数据缺口') && dtGo.includes('分数低有两种可能'))

console.log('\n合计：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail ? 1 : 0)
