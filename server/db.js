'use strict'
/**
 * 工作台数据落库：SQLite（Node 22 内置 node:sqlite，依然零第三方依赖）
 *
 * 设计取舍
 * - 单表 state，按前端 store 的「顶层集合」粒度存整块 JSON（projects / docs / pdocs …）。
 *   不按字段建宽表：业务对象结构一直在演进，宽表每加一个字段都要迁移，而读写粒度天然是「整个集合」，
 *   存 JSON 让前端逻辑零改动即可上云；代价是同集合内的并发写互相覆盖 → 用 rev 做乐观检测，冲突时提示。
 * - WAL + synchronous=NORMAL：写入不等磁盘 fsync，读不阻塞写；进程崩溃只丢最后一个事务。
 * - 同步 API（DatabaseSync）：单进程内写入天然串行，不会阻塞事件循环超过一帧的时间。
 * - updated_by：无鉴权场景下留一个「浏览器实例标识」，出问题时能区分是谁写的。
 */

const { DatabaseSync } = require('node:sqlite')
const fs = require('node:fs')
const path = require('node:path')

let _db = null
let _s = {}
let _file = null

const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

function init(dbFile) {
  if (_db) return _db
  _file = dbFile
  fs.mkdirSync(path.dirname(dbFile), { recursive: true })
  _db = new DatabaseSync(dbFile)
  _db.exec('PRAGMA journal_mode=WAL')
  _db.exec('PRAGMA synchronous=NORMAL')
  _db.exec('PRAGMA busy_timeout=5000')
  // 大集合一次写入可能让 -wal 涨到数 MB；1MB 触发 checkpoint，并把 checkpoint 后的 WAL 文件收回到 8MB 以内
  _db.exec('PRAGMA wal_autocheckpoint=256')
  _db.exec('PRAGMA journal_size_limit=8388608')
  _db.exec(`CREATE TABLE IF NOT EXISTS state (
    key        TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    rev        INTEGER NOT NULL DEFAULT 1,
    size       INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL DEFAULT ''
  )`)
  /* 页面上传的资料原件（项目知识库文件、合同附件、报价 Excel）以 BLOB 存进同一个库：
     与业务数据同库 → 迁盘/换机只搬一个文件，也不会再出现「记录在库、原件在目录」两套状态。 */
  _db.exec(`CREATE TABLE IF NOT EXISTS files (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    mime       TEXT NOT NULL DEFAULT '',
    size       INTEGER NOT NULL DEFAULT 0,
    scope      TEXT NOT NULL DEFAULT '',
    data       BLOB NOT NULL,
    created_at INTEGER NOT NULL
  )`)
  _db.exec('CREATE INDEX IF NOT EXISTS files_scope_idx ON files(scope, created_at)')
  _s = {
    all: _db.prepare('SELECT key, data, rev, size, updated_at, updated_by FROM state ORDER BY key'),
    allByPrefix: _db.prepare('SELECT key, data, rev, size, updated_at, updated_by FROM state WHERE key LIKE ? ORDER BY key'),
    one: _db.prepare('SELECT key, data, rev, size, updated_at, updated_by FROM state WHERE key = ?'),
    ins: _db.prepare('INSERT INTO state(key, data, rev, size, updated_at, updated_by) VALUES(?, ?, 1, ?, ?, ?)'),
    upd: _db.prepare('UPDATE state SET data=?, rev=rev+1, size=?, updated_at=?, updated_by=? WHERE key=?'),
    del: _db.prepare('DELETE FROM state WHERE key=?'),
    stat: _db.prepare('SELECT count(*) AS keys, COALESCE(sum(size),0) AS bytes, COALESCE(max(updated_at),0) AS last_at FROM state'),
    fIns: _db.prepare('INSERT INTO files(id, name, mime, size, scope, data, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)'),
    fGet: _db.prepare('SELECT id, name, mime, size, scope, created_at, data FROM files WHERE id = ?'),
    fMeta: _db.prepare('SELECT id, name, mime, size, scope, created_at FROM files WHERE id = ?'),
    fList: _db.prepare('SELECT id, name, mime, size, scope, created_at FROM files ORDER BY created_at DESC LIMIT 2000'),
    fListScope: _db.prepare('SELECT id, name, mime, size, scope, created_at FROM files WHERE scope LIKE ? ORDER BY created_at DESC LIMIT 2000'),
    fDel: _db.prepare('DELETE FROM files WHERE id = ?'),
    fStat: _db.prepare('SELECT count(*) AS n, COALESCE(sum(size),0) AS bytes FROM files'),
  }
  return _db
}

function assertKey(key) {
  const k = String(key || '')
  if (!KEY_RE.test(k)) throw new Error('非法的集合名：' + k.slice(0, 64))
  return k
}

function rowOut(r, withData = true) {
  if (!r) return null
  const out = { rev: r.rev, size: r.size, updated_at: r.updated_at, updated_by: r.updated_by }
  if (withData) { try { out.data = JSON.parse(r.data) } catch (_) { out.data = null } }
  return out
}

/** 全部集合；withData=false 时只回元信息（rev/size/更新时间），供轮询比对 */
function listAll(withData = true) {
  const out = {}
  for (const r of _s.all.all()) out[r.key] = rowOut(r, withData)
  return out
}
/** 按 key 前缀列出集合（多用户隔离：u_<id>__ 前缀 = 某用户分桶）；prefix 为空退化为全量 */
function listByPrefix(prefix, withData = true) {
  const p = String(prefix || '')
  if (!p) return listAll(withData)
  const out = {}
  for (const r of _s.allByPrefix.iterate(p + '%')) out[r.key] = rowOut(r, withData)
  return out
}

/** 单个集合 */
function get(key, withData = true) {
  return rowOut(_s.one.get(assertKey(key)), withData)
}

/**
 * 写入一个集合。
 * opts.rev  —— 客户端读到的版本号；不匹配且未 force → 返回 {conflict:true}，不写。
 * opts.force —— 明确「最后写入覆盖」，跳过版本检测。
 */
function put(key, data, opts = {}) {
  const k = assertKey(key)
  const json = JSON.stringify(data === undefined ? null : data)
  const by = String(opts.by || '').slice(0, 32)
  const now = Date.now()
  const wantRev = Number.isFinite(Number(opts.rev)) && Number(opts.rev) > 0 ? Number(opts.rev) : null

  _db.exec('BEGIN IMMEDIATE')
  try {
    const cur = _s.one.get(k)
    if (cur && wantRev !== null && !opts.force && cur.rev !== wantRev) {
      _db.exec('ROLLBACK')
      return { conflict: true, rev: cur.rev, updated_at: cur.updated_at, updated_by: cur.updated_by }
    }
    if (cur) _s.upd.run(json, json.length, now, by, k)
    else _s.ins.run(k, json, json.length, now, by)
    _db.exec('COMMIT')
  } catch (e) {
    try { _db.exec('ROLLBACK') } catch (_) {}
    throw e
  }
  const row = _s.one.get(k)
  return { ok: true, key: k, rev: row.rev, size: row.size, updated_at: row.updated_at }
}

/** 批量写（导入 / 首次上云）。逐集合各自一次事务，避免一个超长事务占住写锁。 */
function putMany(states, opts = {}) {
  const written = []
  const conflicts = []
  for (const [k, data] of Object.entries(states || {})) {
    try {
      const r = put(k, data, opts)
      if (r.conflict) conflicts.push({ key: k, rev: r.rev })
      else written.push({ key: k, rev: r.rev })
    } catch (_) { /* 非法集合名直接跳过，不影响其余键 */ }
  }
  return { written, conflicts }
}

function remove(key) {
  const k = assertKey(key)
  _s.del.run(k)
  return { ok: true, key: k }
}

/** 供 /api/health 与排查使用 */
function info() {
  let size = 0
  try { size = fs.statSync(_file).size } catch (_) {}
  let wal = 0
  try { wal = fs.statSync(_file + '-wal').size } catch (_) {}
  const st = _s.stat.get()
  const fs_ = _s.fStat.get()
  const ver = _db.prepare('select sqlite_version() v').get().v
  return {
    file: _file,
    fileMB: Math.round((size / 1048576) * 100) / 100,
    walKB: Math.round((wal / 1024) * 10) / 10,
    collections: st.keys,
    dataKB: Math.round((st.bytes / 1024) * 10) / 10,
    lastWriteAt: st.last_at || 0,
    files: fs_.n,
    filesMB: Math.round((fs_.bytes / 1048576) * 100) / 100,
    sqlite: ver,
  }
}

/* ---------------- 上传资料（BLOB） ---------------- */
function toBuf(v) {
  if (v == null) return null
  if (Buffer.isBuffer(v)) return v
  if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
  return null
}

/** meta: {id,name,mime,scope,buf,createdAt} */
function putFile(meta) {
  const id = String(meta.id || '').slice(0, 128)
  if (!id) throw new Error('缺少文件 ID')
  const buf = toBuf(meta.buf)
  if (!buf || !buf.length) throw new Error('文件内容为空')
  _s.fIns.run(id, String(meta.name || id).slice(0, 255), String(meta.mime || '').slice(0, 127),
    buf.length, String(meta.scope || '').slice(0, 127), buf, Number(meta.createdAt) || Date.now())
  return { ok: true, fileId: id, name: String(meta.name || id), size: buf.length, mime: String(meta.mime || '') }
}

function fileMeta(id) {
  const r = _s.fMeta.get(String(id || ''))
  return r || null
}

/** 返回 {meta..., buf:Buffer} */
function getFile(id) {
  const r = _s.fGet.get(String(id || ''))
  if (!r) return null
  const buf = toBuf(r.data)
  if (!buf) return null
  return { id: r.id, name: r.name, mime: r.mime, size: r.size, scope: r.scope, created_at: r.created_at, buf }
}

/** scopePrefix 传空则列全部 */
function listFiles(scopePrefix) {
  const p = String(scopePrefix || '')
  const rows = p ? _s.fListScope.all(p + '%') : _s.fList.all()
  return rows.map(r => ({ fileId: r.id, name: r.name, mime: r.mime, size: r.size, scope: r.scope, created_at: r.created_at }))
}

function delFile(id) {
  const r = _s.fDel.run(String(id || ''))
  return { ok: true, fileId: String(id || ''), deleted: Number(r.changes || 0) > 0 }
}

module.exports = { init, listAll, listByPrefix, get, put, putMany, remove, info, assertKey, putFile, getFile, fileMeta, listFiles, delFile }
