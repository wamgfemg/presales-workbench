'use strict'
/**
 * 售前工作台 · 文件内容提取（零第三方 npm 依赖）
 * - txt/md/json/csv: 直接按 UTF-8 / GBK 解码
 * - docx: 纯 Node 内建 zlib 解压 + 解析 word/document.xml
 * - 其他格式: 返回不支持的提示
 */

const zlib = require('node:zlib')

const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'yaml', 'yml', 'xml', 'html', 'htm'])

function decodeText(buf) {
  // 优先 UTF-8；失败则尝试 GBK（中文 Windows 常见）
  try {
    const s = buf.toString('utf8')
    // 简单校验：如果包含非法替换字符，尝试 GBK
    if (s.indexOf('\uFFFD') === -1) return s
  } catch (_) {}
  try {
    // Node 内置没有 iconv，但 GBK 单字节兼容 ASCII；这里用 latin1 兜底，避免丢字节
    return buf.toString('latin1')
  } catch (_) {
    return buf.toString('utf8', { errors: 'replace' })
  }
}

function stripXmlTags(xml) {
  // 去掉 XML 标签，保留标签之间的文本；同时处理 <w:tab/> <w:br/> 等
  return xml
    .replace(/<w:tab\s*\/>/gi, '\t')
    .replace(/<w:br\s*\/?>|<w:cr\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\s+/g, ' ')
    .trim()
}

/* ---------------- 最小化 ZIP 解析器（仅支持 stored/deflate） ---------------- */
function findEocd(buf) {
  const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  let i = buf.length - 22
  const min = Math.max(0, buf.length - 65535 - 22)
  while (i >= min) {
    if (buf[i] === sig[0] && buf[i + 1] === sig[1] && buf[i + 2] === sig[2] && buf[i + 3] === sig[3]) return i
    i--
  }
  return -1
}

function parseZip(buf) {
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件（找不到中央目录）')
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const cdCount = buf.readUInt16LE(eocd + 8)
  const files = new Map()
  let p = cdOffset
  for (let i = 0; i < cdCount; i++) {
    if (buf[p] !== 0x50 || buf[p + 1] !== 0x4b || buf[p + 2] !== 0x01 || buf[p + 3] !== 0x02) break
    const comp = buf.readUInt16LE(p + 10)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8')
    files.set(name, { comp, uncompSize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return {
    read(name) {
      const f = files.get(name)
      if (!f) throw new Error('ZIP 中找不到 ' + name)
      const local = f.localOffset
      const nameLen2 = buf.readUInt16LE(local + 26)
      const extraLen2 = buf.readUInt16LE(local + 28)
      const dataOff = local + 30 + nameLen2 + extraLen2
      const raw = buf.slice(dataOff, dataOff + f.uncompSize)
      if (f.comp === 0) return raw
      if (f.comp === 8) return zlib.inflateRawSync(raw)
      throw new Error('不支持的压缩方法 ' + f.comp)
    },
    has(name) { return files.has(name) },
  }
}

function extractDocx(buf) {
  const zip = parseZip(buf)
  const target = zip.has('word/document.xml') ? 'word/document.xml' : 'word/document2.xml'
  if (!zip.has(target)) throw new Error('docx 中找不到 word/document.xml')
  const xml = zip.read(target).toString('utf8')
  return stripXmlTags(xml)
}

/* ---------------- 旧版 .doc（OLE2 / CFB）纯 JS 提取 ---------------- */
function ru32(b, o) { return b.readUInt32LE(o) }
function ru16(b, o) { return b.readUInt16LE(o) }

const OLE_MAGIC = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
const ENDOFCHAIN = 0xFFFFFFFE
const FREE = 0xFFFFFFFF
const DIFSECT = 0xFFFFFFFD

class CFB {
  constructor(data) {
    this.data = data
    if (data.length < 512 || !data.slice(0, 8).equals(OLE_MAGIC)) throw new Error('不是 OLE2 复合文档')
    this.secShift = ru16(data, 0x1E)
    this.secSize = 1 << this.secShift
    this.miniShift = ru16(data, 0x20)
    this.miniSize = 1 << this.miniShift
    this.cutoff = ru32(data, 0x38)
    this.numFat = ru32(data, 0x2C)
    this.firstDir = ru32(data, 0x30)
    this.firstMini = ru32(data, 0x40)
    this.numMini = ru32(data, 0x44)
    this.firstDifat = ru32(data, 0x48)
    // 收集 FAT 扇区 ID（前 109 个来自头部 DIFAT，其余沿 DIFAT 链）
    const fatSectors = []
    for (let i = 0; i < Math.min(109, this.numFat); i++) fatSectors.push(ru32(data, 0x4C + i * 4))
    const seen = new Set()
    let sec = this.firstDifat
    let guard = 0
    while (sec !== ENDOFCHAIN && sec !== FREE && sec !== DIFSECT && fatSectors.length < this.numFat && !seen.has(sec) && guard < 10000) {
      seen.add(sec)
      guard++
      const base = (sec + 1) * this.secSize
      const per = Math.floor(this.secSize / 4)
      for (let i = 0; i < per - 1; i++) fatSectors.push(ru32(data, base + i * 4)) // 末 4 字节是下一 DIFAT 指针
      sec = ru32(data, base + this.secSize - 4)
    }
    // 扁平化 FAT：fat[sectorN] = 下一扇区
    this.fat = []
    for (const fsid of fatSectors) {
      const base = (fsid + 1) * this.secSize
      for (let i = 0; i < Math.floor(this.secSize / 4); i++) this.fat.push(ru32(data, base + i * 4))
    }
    this.miniFat = this.firstMini ? this._readChain(this.firstMini).slice(0, this.numMini * this.secSize) : Buffer.alloc(0)
    this.dir = this._readChain(this.firstDir)
    const root = this._entry(0)
    this.miniStream = this._readChain(root.start).slice(0, root.size)
  }

  _readChain(first) {
    const parts = []
    const seen = new Set()
    let sec = first
    let guard = 0
    while (sec !== ENDOFCHAIN && sec !== FREE && sec >= 0 && sec < this.fat.length) {
      if (seen.has(sec)) break
      seen.add(sec)
      const base = (sec + 1) * this.secSize
      parts.push(this.data.slice(base, base + this.secSize))
      guard++
      if (guard > 100000) break
      sec = this.fat[sec]
    }
    return Buffer.concat(parts)
  }

  _readStream(first, size) {
    if (size <= this.cutoff) {
      const parts = []
      const seen = new Set()
      let sec = first
      let guard = 0
      while (sec !== ENDOFCHAIN && sec !== FREE && sec >= 0 && sec * 4 + 4 <= this.miniFat.length) {
        if (seen.has(sec)) break
        seen.add(sec)
        const base = sec * this.miniSize
        parts.push(this.miniStream.slice(base, base + this.miniSize))
        guard++
        if (guard > 100000) break
        sec = this.miniFat.readUInt32LE(sec * 4)
      }
      return Buffer.concat(parts).slice(0, size)
    }
    return this._readChain(first).slice(0, size)
  }

  _entry(idx) {
    const o = idx * 128
    const raw = this.dir.slice(o, o + 128)
    const nameLen = ru16(raw, 0x40)
    const nmRaw = nameLen > 2 ? raw.slice(0, nameLen - 2) : raw.slice(0, 62)
    let name
    try { name = nmRaw.toString('utf16le') } catch (_) { name = nmRaw.toString('latin1') }
    return { name, type: raw[0x42], start: ru32(raw, 0x74), size: ru32(raw, 0x78) }
  }

  getStream(target) {
    const n = Math.floor(this.dir.length / 128)
    for (let i = 0; i < n; i++) {
      const e = this._entry(i)
      if (e.type === 2 && e.name === target) return this._readStream(e.start, e.size)
    }
    return null
  }
}

function _cleanDoc(text) {
  let s = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if (ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\x0b') s += ch
    else if ((cp >= 32 && cp < 127) ||
      (cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3000 && cp <= 0x303F) ||
      (cp >= 0xFF00 && cp <= 0xFFEF) || (cp >= 0x2000 && cp <= 0x206F)) s += ch
    else s += ' '
  }
  s = s.replace(/\f/g, '\n').replace(/\x0b/g, '\n')
  s = s.replace(/[ \t]+/g, ' ')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

function _quality(text) {
  if (!text) return 0
  const n = Math.min(400, text.length)
  let ok = 0
  for (let i = 0; i < n; i++) {
    const ch = text[i]
    const cp = ch.codePointAt(0)
    if (ch === '\n' || ch === '\r' || ch === '\t' || ch === ' ') ok++
    else if (cp >= 32 && cp < 127) ok++
    else if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3000 && cp <= 0x303F) ||
      (cp >= 0xFF00 && cp <= 0xFFEF) || (cp >= 0x2000 && cp <= 0x206F)) ok++
  }
  return ok / n
}

function _extractDocxPieces(cfb, wd) {
  const tbl = cfb.getStream('1Table') || cfb.getStream('0Table')
  if (!tbl) return null
  const fcClx = ru32(wd, 0x1A2)
  const lcbClx = ru32(wd, 0x1A6)
  if (fcClx + lcbClx > tbl.length) return null
  const clx = tbl.slice(fcClx, fcClx + lcbClx)
  let i = 0
  let plcpcd = null
  while (i < clx.length) {
    const t = clx[i]
    if (t === 1) { plcpcd = clx.slice(i + 1); break }
    else if (t === 2) { const sz = ru16(clx, i + 1); i += 2 + sz }
    else i += 1
  }
  if (plcpcd == null) return null
  const n = Math.floor((plcpcd.length - 4) / 12)
  if (n <= 0) return null
  const cps = []
  for (let j = 0; j <= n; j++) cps.push(ru32(plcpcd, j * 4))
  if (!(cps[0] === 0 && cps.every((v, j) => j === 0 || v > cps[j - 1]))) return null
  const chunks = []
  for (let j = 0; j < n; j++) {
    const count = cps[j + 1] - cps[j]
    if (count <= 0) continue
    const pcd = ru32(plcpcd, 4 + j * 8 + 2)
    const fc = pcd & 0x3FFFFFFF
    const compressed = (pcd & 0x40000000) !== 0
    const start = fc * 2
    let s
    if (compressed) {
      const raw = wd.slice(start, start + count)
      try { s = raw.toString('gbk') } catch (_) { s = raw.toString('latin1') }
    } else {
      const raw = wd.slice(start, start + count * 2)
      s = raw.toString('utf16le')
    }
    chunks.push(s)
  }
  return chunks.join('')
}

function extractDoc(buf) {
  const cfb = new CFB(buf)
  const wd = cfb.getStream('WordDocument')
  if (!wd) throw new Error('未找到 WordDocument 流')
  const fcMin = ru32(wd, 0x18)
  const ccpText = ru32(wd, 0x4C)
  let text = _extractDocxPieces(cfb, wd)
  if (text == null || _quality(text) < 0.8) {
    // 回退：WordDocument 流中从 fcMin 开始的连续 UTF-16LE 块（老格式单分片文档）
    const raw = wd.slice(fcMin, fcMin + ccpText * 2)
    text = raw.toString('utf16le')
  }
  return _cleanDoc(text)
}

/* ---------------- 调度 ---------------- */
function extOf(name) {
  const m = String(name).match(/\.([a-zA-Z0-9]+)$/)
  return m ? m[1].toLowerCase() : ''
}

function extractText(name, buf) {
  const ext = extOf(name)
  if (!buf || !buf.length) return { name, ext, text: '', chars: 0, ok: true }
  if (TEXT_EXTS.has(ext)) {
    const text = decodeText(buf)
    return { name, ext, text, chars: text.length, ok: true }
  }
  if (ext === 'docx') {
    const text = extractDocx(buf)
    return { name, ext, text, chars: text.length, ok: true }
  }
  if (ext === 'doc') {
    try {
      const text = extractDoc(buf)
      return { name, ext, text, chars: text.length, ok: true }
    } catch (e) {
      return { name, ext, text: '', chars: 0, ok: false, error: '解析 .doc 失败：' + (e && e.message || e) }
    }
  }
  return {
    name, ext, text: '', chars: 0, ok: false,
    error: `暂不支持 ${ext || '该'} 格式，请上传 .txt/.md/.json/.csv/.docx，或将 PDF/PPT/Excel 内容粘贴到输入框。`,
  }
}

module.exports = { extractText, extOf, TEXT_EXTS, extractDoc, CFB }
