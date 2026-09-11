'use strict'
/**
 * 异步任务层：将 Hermes 对话解耦为后台任务
 *
 * - 前端提交后立即获得 taskId，SSE 实时流式转发事件
 * - SSE 断开后后台任务继续运行，前端可轮询 /api/chat/poll/:taskId 获取结果
 * - 即使浏览器关闭、网络断开，几小时后任务完成仍可查询结果
 * - 完成的任务持久化到文件，服务重启后仍可查询（进行中的任务丢失）
 */

const path = require('node:path')
const fs = require('node:fs')

const DATA_DIR = process.env.DATA_DIR || '/opt/presales-workbench/data'
const TASK_FILE = path.join(DATA_DIR, 'async-tasks.json')
const TASK_RETAIN_MS = Number(process.env.TASK_RETAIN_MS || 48 * 60 * 60 * 1000)
const MAX_EVENTS = Number(process.env.TASK_MAX_EVENTS || 300)

const _tasks = new Map()

function _uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

function _log(...a) {
  console.log(new Date().toISOString(), '[async-task]', ...a)
}

function _load() {
  try {
    const raw = fs.readFileSync(TASK_FILE, 'utf8')
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return
    const now = Date.now()
    for (const t of arr) {
      if (!t || !t.id) continue
      if (t.createdAt && now - t.createdAt > TASK_RETAIN_MS) continue
      if (t.status === 'done' || t.status === 'error') {
        _tasks.set(t.id, t)
      }
    }
    _log(`从文件恢复 ${_tasks.size} 个已完成任务`)
  } catch (_) {}
}

function _save() {
  try {
    const arr = [..._tasks.values()].filter(
      (t) => t.status === 'done' || t.status === 'error'
    )
    fs.mkdirSync(path.dirname(TASK_FILE), { recursive: true })
    fs.writeFileSync(TASK_FILE, JSON.stringify(arr, null, 2), 'utf8')
  } catch (e) {
    _log('保存 async-tasks 失败:', e && e.message)
  }
}

_load()

function _sweep() {
  const now = Date.now()
  let changed = false
  for (const [id, t] of _tasks) {
    if (now - (t.createdAt || 0) > TASK_RETAIN_MS) {
      _tasks.delete(id)
      changed = true
    }
  }
  if (changed) _save()
}
setInterval(_sweep, 10 * 60 * 1000).unref?.()

/**
 * 检查 key 是否已有进行中的任务
 */
function findRunning(key) {
  for (const t of _tasks.values()) {
    if (t.key === key && t.status === 'processing') return t
  }
  return null
}

/**
 * 创建后台任务并立即开始处理
 * @param {object} pool - HermesPool 实例
 * @param {string} key - 任务 key（前端 taskId）
 * @param {string} text - prompt 文本
 * @param {object} opts - { sessionId, reset }
 * @returns {object} task
 */
function createTask(pool, key, text, opts = {}) {
  const taskId = _uid()
  const task = {
    id: taskId,
    key,
    text,
    status: 'processing',
    result: '',
    events: [],
    error: null,
    sessionId: null,
    storedSessionId: null,
    model: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    _retried: false,
  }
  _tasks.set(taskId, task)

  _runTask(pool, task, opts).catch((e) => {
    task.status = 'error'
    task.error = String(e && e.message || e)
    task.updatedAt = Date.now()
    _save()
  })

  return task
}

async function _runTask(pool, task, opts) {
  try {
    if (opts.reset) pool.drop(task.key)

    const sess = pool.get(task.key, opts.sessionId)
    if (!sess.connected) {
      task.events.push({ type: 'status', text: '正在连接专家智能体…', ts: Date.now() })
      const info = await sess.open(opts.sessionId)
      task.sessionId = sess.sessionId
      task.storedSessionId = sess.storedSessionId
      task.model = sess.model
      task.events.push({
        type: 'session',
        sessionId: sess.sessionId,
        storedSessionId: sess.storedSessionId,
        model: sess.model,
        ts: Date.now(),
      })
      pool.recordSession(task.key, sess.sessionId, sess.storedSessionId)
    }

    const result = await sess.submit(task.text, (ev) => {
      task.events.push({ ...ev, ts: Date.now() })
      task.updatedAt = Date.now()
      if (ev.type === 'delta') {
        task.result += ev.text || ''
      }
      if (task.events.length > MAX_EVENTS) {
        task.events = task.events.slice(-MAX_EVENTS)
      }
    })

    task.status = 'done'
    task.result = result.text || task.result
    task.sessionId = result.sessionId || task.sessionId
    task.storedSessionId = result.storedSessionId || task.storedSessionId
    pool.recordSession(task.key, task.sessionId, task.storedSessionId)
    _log(`任务 ${task.id} 完成，结果 ${task.result.length} 字符`)
    _save()
  } catch (err) {
    const msg = String(err && err.message || err)
    const retryable =
      /session not found|WebSocket|未连接|已断开|断开|closed|ECONN|fetch failed/i.test(
        msg
      )
    if (retryable && !task._retried) {
      task._retried = true
      task.events.push({
        type: 'status',
        text: '会话已失效，正在重建…',
        ts: Date.now(),
      })
      _log(`任务 ${task.id} 首次失败，重试: ${msg}`)
      pool.drop(task.key)
      return _runTask(pool, task, { sessionId: null, reset: false })
    }

    task.status = 'error'
    task.error = msg
    task.updatedAt = Date.now()
    _log(`任务 ${task.id} 失败: ${msg}`)
    _save()
  }
}

function getTask(taskId) {
  return _tasks.get(taskId) || null
}

function listTasks(key) {
  return [..._tasks.values()].filter((t) => !key || t.key === key)
}

function stats() {
  let processing = 0,
    done = 0,
    error = 0
  for (const t of _tasks.values()) {
    if (t.status === 'processing') processing++
    else if (t.status === 'done') done++
    else if (t.status === 'error') error++
  }
  return { total: _tasks.size, processing, done, error }
}

module.exports = { createTask, getTask, listTasks, findRunning, stats }
