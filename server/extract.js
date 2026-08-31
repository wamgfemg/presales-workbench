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
  return {
    name, ext, text: '', chars: 0, ok: false,
    error: `暂不支持 ${ext || '该'} 格式，请上传 .txt/.md/.json/.csv/.docx，或将 PDF/PPT/Excel 内容粘贴到输入框。`,
  }
}

module.exports = { extractText, extOf, TEXT_EXTS }
