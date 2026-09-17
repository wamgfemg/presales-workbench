#!/usr/bin/env node
/* ============================================================================
 * P0 回归断言 —— 守住两类已经真实进过生产库的缺陷
 *
 *   P0-1  kb-weknora.js 顶层声明了 function fmtDate()，把 main.js 的全局
 *         日期函数顶掉 → today()/addDays()/dueState() 全站失效
 *   P0-2  mytodo.js 用 var esc=... 遮蔽了全局转义函数 esc() → 团队视图整页崩溃
 *
 * 本文件是「静态语法契约 + 函数语义」双层断言，零依赖，只用 node 内置模块。
 *
 * 运行（不碰生产容器，用一次性容器即可）：
 *   docker run --rm -v /opt/presales-workbench:/w -w /w node:22-alpine \
 *     node test/p0-assert.cjs
 * ========================================================================== */
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'frontend', 'src')
const INDEX = path.join(ROOT, 'frontend', 'index.html')

let pass = 0
const failures = []
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  PASS  ' + msg) }
  else { failures.push(msg); console.log('  FAIL  ' + msg + (extra ? '\n        -> ' + extra : '')) }
}
function section(t) { console.log('\n=== ' + t + ' ===') }

/* 从源码里按大括号配平抽出一个函数的完整定义（含起始行号） */
function extractFns(text, name) {
  const out = []
  const re = new RegExp('function\\s+' + name + '\\s*\\(', 'g')
  let m
  while ((m = re.exec(text))) {
    const i = text.indexOf('{', m.index)
    if (i < 0) continue
    let depth = 0, j = i
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') { depth--; if (depth === 0) break }
    }
    if (depth !== 0) continue
    out.push({ line: text.slice(0, m.index).split('\n').length, src: text.slice(m.index, j + 1) })
  }
  return out
}

/* ---------------------------------------------------------------------------
 * 0. 按 index.html 的真实加载顺序（后加载者覆盖先加载者）确定待检文件
 * ------------------------------------------------------------------------ */
const html = fs.readFileSync(INDEX, 'utf8')
let order = []
for (const m of html.matchAll(/<script\s+src="\.\/src\/([^"]+)"><\/script>/g)) order.push(m[1])
if (!order.length) order = fs.readdirSync(SRC).filter(f => f.endsWith('.js')).sort()
const srcOf = {}
for (const f of order) srcOf[f] = fs.readFileSync(path.join(SRC, f), 'utf8')
console.log('加载顺序（' + order.length + ' 个文件）: ' + order.join(' → '))

/* ---------------------------------------------------------------------------
 * 1. 跨文件顶层重名 —— 拦「补丁文件误撞主文件全局符号」整类问题
 *
 *    白名单 = 文件头已注明「有意覆盖 main.js 同名函数」的补丁文件所暴露的符号。
 *    白名单之外的任何重名，一律视为缺陷。
 * ------------------------------------------------------------------------ */
section('1. 跨文件顶层重名检查')
const INTENTIONAL = {
  'hermes-chat.js': ['chatBodyHtml', 'createDocTask', 'genDraft', 'qwInputBar',
                     'renderRightPanel', 'renderTaskList', 'sendChat'],
}

const decls = {} // name -> [{file, line, text}]
for (const f of order) {
  srcOf[f].split('\n').forEach((ln, i) => {
    let m = ln.match(/^(?:let|const|var|function|async function)\s+([A-Za-z_$][\w$]*)/)
    if (!m) m = ln.match(/^\s*window\.([A-Za-z_$][\w$]*)\s*=/)
    if (!m) return
    ;(decls[m[1]] = decls[m[1]] || []).push({ file: f, line: i + 1, text: ln.trim() })
  })
}

let dupCount = 0, dupAllowed = 0
for (const name of Object.keys(decls).sort()) {
  const where = decls[name]
  if (where.length < 2) continue
  dupCount++
  const files = where.map(w => w.file)
  const allowFile = Object.keys(INTENTIONAL).find(f => INTENTIONAL[f].includes(name) && files.includes(f))
  if (allowFile) {
    // 有意覆盖：必须确保覆盖方确实在加载顺序中靠后，且恰好两组声明
    const iOver = order.indexOf(allowFile)
    const iBase = Math.min.apply(null, files.filter(f => f !== allowFile).map(f => order.indexOf(f)))
    if (files.length === 2 && iOver > iBase) { dupAllowed++; continue }
    ok(false, '有意覆盖 ' + name + '（' + allowFile + '）加载顺序不对：' + files.join(' vs '))
    continue
  }
  ok(false, '顶层符号重名（未登记的有意覆盖）: ' + name,
     where.map(w => w.file + ':' + w.line).join('  vs  '))
}
ok(true, '扫描 ' + Object.keys(decls).length + ' 个顶层符号，其中重名 ' + dupCount + ' 组' +
          '（登记的有意覆盖 ' + dupAllowed + ' 组，其余已单独报错）')

/* ---------------------------------------------------------------------------
 * 2. P0-1 专项 —— 全局日期函数必须唯一且来自 main.js
 * ------------------------------------------------------------------------ */
section('2. P0-1 专项：全局日期函数唯一性')
for (const fn of ['fmtDate', 'today', 'addDays', 'dueState']) {
  const where = decls[fn] || []
  ok(where.length === 1 && where[0].file === 'main.js',
     '全局 ' + fn + '() 唯一定义于 main.js',
     where.length ? where.map(w => w.file + ':' + w.line).join(', ') : '未找到定义')
}
ok(!/\bfmtDate\b/.test(srcOf['kb-weknora.js'] || ''),
   'kb-weknora.js 中已无任何 fmtDate 引用（缺陷注入点）')

/* ---------------------------------------------------------------------------
 * 3. P0-2 专项 —— 全局 esc() 不得被局部变量遮蔽
 *    (a) 遮蔽（var/let/const esc = ...）→ 硬失败，这就是 P0-2 本体
 *    (b) 多个文件各自重复定义同名全局函数 → 按「实现是否一致」分级：
 *        实现完全一致 = 冗余（WARN，不阻断）；实现不同 = 覆盖风险（FAIL）
 * ------------------------------------------------------------------------ */
section('3. P0-2 专项：全局 esc() 不被局部变量遮蔽')
const shadow = []
const defs = []
for (const f of order) {
  srcOf[f].split('\n').forEach((ln, i) => {
    if (/(^|[^\w$.])(?:var|let|const)\s+esc\s*=/.test(ln)) shadow.push(f + ':' + (i + 1))
  })
  for (const d of extractFns(srcOf[f], 'esc')) defs.push({ file: f, line: d.line, src: d.src })
}
ok(shadow.length === 0, '全局 esc() 未被任何局部变量遮蔽', shadow.join(', '))
ok(/\bescList\b/.test(srcOf['mytodo.js'] || ''), 'mytodo.js 已使用 escList 承载「需升级」列表')

// 多个文件各自重复定义 esc()：用「行为比对」判定是冗余还是真覆盖
if (defs.length > 1) {
  const PROBE = ['<', '>', '&', '"', "a<b&c\"d", null, undefined, 0, false, '', 123, "it's"]
  const results = defs.map(d => {
    try {
      const ctx = {}
      vm.createContext(ctx)
      vm.runInContext('__esc = (' + d.src + ');', ctx)
      return { file: d.file, line: d.line, out: PROBE.map(x => ctx.__esc(x)) }
    } catch (e) {
      return { file: d.file, line: d.line, out: null, err: e.message }
    }
  })
  const bad = results.filter(r => r.out === null)
  const sigs = Array.from(new Set(results.filter(r => r.out).map(r => JSON.stringify(r.out))))
  if (bad.length) {
    ok(false, 'esc() 定义无法求值', bad.map(r => r.file + ':' + r.line + ' ' + r.err).join(', '))
  } else if (sigs.length === 1) {
    pass++
    console.log('  WARN  esc() 在 ' + defs.length + ' 个文件中重复定义（' +
      defs.map(d => d.file).join(', ') + '）\n' +
      '        -> 对 ' + PROBE.length + ' 组输入行为完全一致，暂无功能风险；属冗余，建议收敛为单一定义')
  } else {
    ok(false, 'esc() 存在行为不一致的多份定义（后加载者会静默改变转义行为）',
       results.map(r => r.file + ':' + r.line).join(', '))
  }
} else {
  ok(defs.length === 1, 'esc() 单一定义于 ' + (defs[0] ? defs[0].file : '(未找到)'))
}

/* ---------------------------------------------------------------------------
 * 4. 日期函数语义断言 —— 抽出 main.js 的真实实现，在 vm 里跑
 * ------------------------------------------------------------------------ */
section('4. 日期函数语义断言（vm 执行 main.js 真实实现）')
const main = srcOf['main.js']
const grab = n => {
  const m = main.match(new RegExp('^function\\s+' + n + '\\s*\\(.*$', 'm'))
  return m ? m[0] : null
}
const parts = {
  fmtDate: grab('fmtDate'), today: grab('today'),
  addDays: grab('addDays'), dueState: grab('dueState'),
}
const soonM = main.match(/^(?:const|let|var)\s+SOON_DAYS\s*=\s*(\d+)/m)
const extracted = Object.keys(parts).filter(k => !parts[k])
ok(extracted.length === 0, '从 main.js 成功抽取 fmtDate/today/addDays/dueState',
   extracted.length ? '抽取失败: ' + extracted.join(', ') + '（函数可能被改成多行实现，请同步更新本测试的抽取正则）' : '')
ok(!!soonM, '从 main.js 成功抽取 SOON_DAYS 常量')

if (!extracted.length && soonM) {
  const code = [
    parts.fmtDate, parts.today,
    'const SOON_DAYS=' + soonM[1] + ';',
    parts.addDays, parts.dueState,
    'this.__f={fmtDate:fmtDate,today:today,addDays:addDays,dueState:dueState,SOON_DAYS:SOON_DAYS};',
  ].join('\n')
  const ctx = {}
  vm.createContext(ctx)
  vm.runInContext(code, ctx)
  const { fmtDate, today, addDays, dueState, SOON_DAYS } = ctx.__f

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
  ok(fmtDate(new Date(2026, 8, 7)) === '2026-09-07',
     'fmtDate 补零正确：fmtDate(2026-09-07) === "2026-09-07"', 'real=' + fmtDate(new Date(2026, 8, 7)))
  ok(DATE_RE.test(today()), 'today() 返回 YYYY-MM-DD 格式', 'real=' + JSON.stringify(today()))

  const p2 = addDays(today(), 2)
  ok(DATE_RE.test(p2), 'addDays(today(),2) 返回合法日期（回归：曾经是 "Invalid Date"）', 'real=' + JSON.stringify(p2))
  const m1 = addDays(today(), -1)
  ok(DATE_RE.test(m1), 'addDays(today(),-1) 返回合法日期（回归）', 'real=' + JSON.stringify(m1))

  ok(String(new Date(today() + 'T00:00:00')).indexOf('Invalid') < 0,
     'new Date(today()+"T00:00:00") 可解析（回归：今天曾是 "Invalid Date"）')
  ok(addDays('2026-09-17', 2) === '2026-09-19', 'addDays 跨日运算正确', 'real=' + addDays('2026-09-17', 2))
  ok(addDays('2026-09-30', 1) === '2026-10-01', 'addDays 跨月运算正确', 'real=' + addDays('2026-09-30', 1))
  ok(addDays('2026-12-31', 1) === '2027-01-01', 'addDays 跨年运算正确', 'real=' + addDays('2026-12-31', 1))

  ok(dueState(addDays(today(), -1)) === 'over', 'dueState(昨天) === "over"（回归：曾误判为 "soon"）',
     'real=' + JSON.stringify(dueState(addDays(today(), -1))))
  ok(dueState(today()) === 'soon', 'dueState(今天) === "soon"', 'real=' + JSON.stringify(dueState(today())))
  ok(dueState(addDays(today(), SOON_DAYS)) === 'soon',
     'dueState(今天+' + SOON_DAYS + '天) === "soon"（窗口边界含端点）', 'real=' + JSON.stringify(dueState(addDays(today(), SOON_DAYS))))
  ok(dueState(addDays(today(), SOON_DAYS + 1)) === '',
     'dueState(今天+' + (SOON_DAYS + 1) + '天) === ""（窗口外）', 'real=' + JSON.stringify(dueState(addDays(today(), SOON_DAYS + 1))))
  ok(dueState('2099-12-31') === '', 'dueState(远期日期) === ""', 'real=' + JSON.stringify(dueState('2099-12-31')))
  ok(dueState('') === '', 'dueState(空值) === ""', 'real=' + JSON.stringify(dueState('')))
  ok(dueState('Invalid Date') !== 'soon' && dueState('Invalid Date') !== 'over',
     'dueState("Invalid Date") 不再产生 "soon"/"over" 假信号', 'real=' + JSON.stringify(dueState('Invalid Date')))
  ok(addDays(today(), -1) < today() && addDays(today(), 1) > today(),
     '日期字符串可比较（字典序 == 时间序的前提是零填充）')
}

/* ---------------------------------------------------------------------------
 * 汇总
 * ------------------------------------------------------------------------ */
console.log('\n' + '='.repeat(66))
if (failures.length === 0) {
  console.log('P0 回归断言：全部通过（' + pass + ' 项）')
  process.exit(0)
} else {
  console.log('P0 回归断言：失败 ' + failures.length + ' 项 / 通过 ' + pass + ' 项')
  failures.forEach(f => console.log('  ✗ ' + f))
  process.exit(1)
}
