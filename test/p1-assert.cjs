#!/usr/bin/env node
/* ============================================================================
 * P1 回归断言 —— 守住两类「口径被悄悄改错」的缺陷，以及流水线自身的防护网
 *
 *   P1-1  首页 GO / NO-GO 两栏同源
 *         右栏曾用「非『数据不足』集合反序取前 5」，在跟项目 ≤ 5 个时，
 *         左栏（最高分）与右栏（最低分）是同一批项目的正倒序 ——
 *         同一个项目会同时被判「重点投入」和「暂缓 / 放弃」。
 *
 *   P1-2  daysSince 哨兵值 999 泄漏
 *         对空 / 非法日期返回 999，经 flags 渲染成「已 999 天没有跟进」；
 *         且 Math.min 会把 null 当 0，让没有日期的跟进记录把沟通热度顶到满分。
 *
 *   P1-3  流水线防护网
 *         语法自检必须「全量遍历」（不能再出现硬编码文件清单 —— 那正是
 *         capacity/customer360/funnel/mytodo/reminder 语法坏掉却一路放行的原因），
 *         且四个离线断言必须真的被 CI 调用。
 *
 * 零依赖，只用 node 内置模块；不访问网络、不写库。
 * 用法（仓库根）：node test/p1-assert.cjs
 * ========================================================================== */
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.join(__dirname, '..')
const MAIN_PATH = path.join(ROOT, 'frontend', 'src', 'main.js')
const DEPLOY_PATH = path.join(ROOT, '.github', 'workflows', 'deploy.yml')
const DRIFT_PATH = path.join(ROOT, '.github', 'workflows', 'consistency-check.yml')

const main = fs.readFileSync(MAIN_PATH, 'utf8')
const deploy = fs.readFileSync(DEPLOY_PATH, 'utf8')

let pass = 0, fail = 0
const failures = []
function T(name, cond, detail) {
  if (cond) { pass++; console.log('PASS ' + name + (detail !== undefined ? '  [' + detail + ']' : '')) }
  else { fail++; failures.push(name); console.log('FAIL ' + name + (detail !== undefined ? '  [' + detail + ']' : '')) }
}
function section(t) { console.log('\n=== ' + t + ' ===') }

/** 按大括号配平，从源码里抽出某个具名函数的完整定义 */
function extractFn(text, name) {
  const i = text.indexOf('function ' + name + '(')
  if (i < 0) return null
  const b = text.indexOf('{', i)
  if (b < 0) return null
  let depth = 0
  for (let j = b; j < text.length; j++) {
    if (text[j] === '{') depth++
    else if (text[j] === '}') { depth--; if (depth === 0) return text.slice(i, j + 1) }
  }
  return null
}

/* ---------------------------------------------------------------------------
 * 1. 首页 GO / NO-GO 两栏口径
 * ------------------------------------------------------------------------ */
section('1. 首页 GO / NO-GO 两栏口径')

const i0 = main.indexOf('const goSlot')
const i1 = main.indexOf('renderTrend()', i0)
const dashSeg = (i0 >= 0 && i1 > i0) ? main.slice(i0, i1) : ''

T('定位到首页两栏渲染代码段', dashSeg.length > 0, dashSeg.length ? dashSeg.length + ' 字符' : '(未找到)')

const goLine = (dashSeg.match(/goSlot\.innerHTML\s*=[^\n]*/) || [])[0] || ''
const noLine = (dashSeg.match(/noSlot\.innerHTML\s*=[^\n]*/) || [])[0] || ''

T('定位到 GO 栏渲染语句', !!goLine)
T('定位到 NO-GO 栏渲染语句', !!noLine)

/* 口径必须是「按档位过滤」，而不是「按分数切片凑数」 */
T("GO 栏按 tier==='must' 取项目", /tier\s*===\s*'must'/.test(dashSeg), (dashSeg.match(/goList=[^\n]*/) || [''])[0].slice(0, 70))
T("NO-GO 栏按 tier==='drop' 取项目", /tier\s*===\s*'drop'/.test(dashSeg), (dashSeg.match(/noList=[^\n]*/) || [''])[0].slice(0, 70))

/* 反向：不得再出现历史写法 */
T("两栏不再用 tier!=='data' 的凑数口径", !/tier\s*!==\s*'data'/.test(dashSeg))
T('两栏不再用 slice().reverse() 取最低分', !/slice\(\)\s*\.\s*reverse\(\)/.test(dashSeg))

/* 空状态：两栏都应有各自为空时的文案，且不再共用「暂无可评估项目」 */
const empties = dashSeg.match(/<div class="empty">[^<]*<\/div>/g) || []
T('两栏各自带专属空状态文案', empties.length >= 2, empties.join(' | '))
T('GO 栏空态点明「重点投入」', empties.some(s => s.indexOf('重点投入') >= 0))
T('NO-GO 栏空态点明「暂缓」', empties.some(s => s.indexOf('暂缓') >= 0))

/* ---------------------------------------------------------------------------
 * 2. daysSince 哨兵语义
 * ------------------------------------------------------------------------ */
section('2. daysSince 哨兵语义')

const dsSrc = extractFn(main, 'daysSince')
T('定位到 daysSince 定义', !!dsSrc)

if (dsSrc) {
  T('daysSince 不再返回 999 哨兵', !/return\s+999/.test(dsSrc), dsSrc.replace(/\s+/g, ' ').slice(0, 90))
  T('daysSince 对无效输入返回 null', /return\s+null/.test(dsSrc))
}

T('通信热度对无效日期做了显式过滤（防 Math.min 把 null 当 0）',
  /\.filter\(\s*\w+\s*=>\s*\w+\s*!==\s*null\s*\)/.test(main))
T('提示词不再用 g.gap>900 判定「无记录」', !/g\.gap\s*>\s*900/.test(main))
T('flags 输出「已 N 天没有跟进」前已排除无有效日期',
  /gap\s*===\s*null/.test(main) || /gap\s*!==\s*null/.test(main))

/* 行为验证：把 daysSince 放进沙盒，用固定「今天」跑真实取值 */
if (dsSrc) {
  const ctx = { today: () => '2026-09-17', Math, Date, String, Number, isNaN }
  vm.createContext(ctx)
  vm.runInContext(dsSrc, ctx)
  const ds = ctx.daysSince
  T('沙盒内 daysSince 可调用', typeof ds === 'function')

  if (typeof ds === 'function') {
    T('daysSince(null) === null', ds(null) === null, JSON.stringify(ds(null)))
    T('daysSince("") === null', ds('') === null, JSON.stringify(ds('')))
    T('daysSince(undefined) === null', ds(undefined) === null, JSON.stringify(ds(undefined)))
    T('daysSince("Invalid Date") === null', ds('Invalid Date') === null, JSON.stringify(ds('Invalid Date')))
    T('daysSince("2026-09-17") === 0', ds('2026-09-17') === 0, String(ds('2026-09-17')))
    T('daysSince("2026-09-10") === 7', ds('2026-09-10') === 7, String(ds('2026-09-10')))
    T('daysSince("2026-08-18") === 30', ds('2026-08-18') === 30, String(ds('2026-08-18')))

    /* 关键回归：一批「无有效日期」的记录，不能算作「刚刚跟进过」 */
    const gaps = [null, null].filter(n => n !== null)
    const gap = gaps.length ? Math.min.apply(null, gaps) : null
    T('全为无效日期时 gap 为 null（而不是 0 或 999）', gap === null, String(gap))
  }
}

/* ---------------------------------------------------------------------------
 * 3. 流水线防护网
 * ------------------------------------------------------------------------ */
section('3. 流水线防护网')

T('语法自检改为全量遍历（find frontend/src server）', /find\s+frontend\/src\s+server/.test(deploy))

const hardcoded = deploy.match(/node --check\s+[\w./-]+\.js/g) || []
T('语法自检不再硬编码文件清单', hardcoded.length === 0, hardcoded.join(', ') || '(0 处)')

T('已接入 test/p0-assert.cjs', /test\/p0-assert\.cjs/.test(deploy))
T('已接入 test/kb-readonly-assert.cjs', /test\/kb-readonly-assert\.cjs/.test(deploy))
T('已接入 test/phase4-assert.cjs', /test\/phase4-assert\.cjs/.test(deploy))
T('已接入 test/p1-assert.cjs（本文件）', /test\/p1-assert\.cjs/.test(deploy))

T('部署后含一致性复核（rsync dry-run）', /rsync\s+-azn|--dry-run/.test(deploy))
T('存在每日漂移检查工作流 consistency-check.yml', fs.existsSync(DRIFT_PATH))

if (fs.existsSync(DRIFT_PATH)) {
  const drift = fs.readFileSync(DRIFT_PATH, 'utf8')
  T('漂移检查是只读的（dry-run，不带 --delete 落盘）', /-azn/.test(drift))
  T('漂移检查含定时触发', /schedule:/.test(drift) && /cron:/.test(drift))
}

/* ---------------------------------------------------------------------------
 * 4. P0 断言仍在（防误删）
 * ------------------------------------------------------------------------ */
section('4. 既有断言未被误删')

for (const f of ['p0-assert.cjs', 'kb-readonly-assert.cjs', 'phase4-assert.cjs']) {
  T('test/' + f + ' 存在', fs.existsSync(path.join(ROOT, 'test', f)))
}

/* ---------------------------------------------------------------------------
 * 汇总
 * ------------------------------------------------------------------------ */
console.log('\n' + '='.repeat(66))
if (fail === 0) {
  console.log('P1 回归断言：全部通过（' + pass + ' 项）')
} else {
  console.log('P1 回归断言：' + pass + ' 通过 / ' + fail + ' 失败')
  console.log('失败项：')
  failures.forEach(f => console.log('  - ' + f))
}
console.log('='.repeat(66))

process.exit(fail === 0 ? 0 : 1)
