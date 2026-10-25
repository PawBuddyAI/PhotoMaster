import { inflateSync } from 'node:zlib'

/** 按顺序列出 PNG 的所有块（不校验 CRC，校验由 readPng16 负责） */
export function pngChunks(bytes: Uint8Array): Array<{ name: string, data: Buffer }> {
  const buffer = Buffer.from(bytes)
  const chunks: Array<{ name: string, data: Buffer }> = []
  for (let offset = 8; offset + 8 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    chunks.push({ name: buffer.toString('ascii', offset + 4, offset + 8), data: buffer.subarray(offset + 8, offset + 8 + length) })
    offset += length + 12
  }
  return chunks
}

/** 独立解码测试输出，同时校验每个 PNG chunk 的 CRC、行过滤和样本字节序。 */
export function readPng16(bytes: Uint8Array, pq = false): { width: number, height: number, pixels: Uint16Array } {
  const buffer = Buffer.from(bytes)
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('PNG signature')
  let width = 0
  let height = 0
  let ended = false
  let srgb = false
  let cicp = false
  const compressed: Buffer[] = []
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    const name = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    let crc = 0xffffffff
    for (const byte of buffer.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
    if (((crc ^ 0xffffffff) >>> 0) !== buffer.readUInt32BE(offset + 8 + length)) throw new Error('PNG CRC')
    if (name === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 16 || data[9] !== 2 || data[12] !== 0) throw new Error('Expected RGB16 non-interlaced PNG')
    }
    if (name === 'sRGB') srgb = true
    if (name === 'cICP') cicp = data.equals(Buffer.from([9, 16, 0, 1]))
    if (name === 'IDAT') compressed.push(data)
    if (name === 'IEND') ended = true
    offset += length + 12
  }
  if (!ended || (pq ? !cicp || srgb : !srgb || cicp)) throw new Error('PNG missing end or color metadata')
  const rows = inflateSync(Buffer.concat(compressed))
  if (rows.length !== height * (width * 6 + 1)) throw new Error('PNG size')
  const pixels = new Uint16Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    const start = y * (width * 6 + 1)
    const filter = rows[start]
    const row = rows.subarray(start + 1, start + 1 + width * 6)
    if (filter === 1) {
      for (let b = 6; b < row.length; b++) row[b] = (row[b]! + row[b - 6]!) & 255
    } else if (filter !== 0) throw new Error('Unexpected PNG filter')
    for (let x = 0; x < width * 3; x++) pixels[y * width * 3 + x] = row.readUInt16BE(x * 2)
  }
  return { width, height, pixels }
}
