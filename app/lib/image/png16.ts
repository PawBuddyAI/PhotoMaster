/** 16 位 RGB PNG 编码。直接写入网络字节序样本，禁止经过 Canvas 的 8 位编码器。 */
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function chunk(name: string, data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(data.length + 12)
  const view = new DataView(result.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) result[4 + i] = name.charCodeAt(i)
  result.set(data, 8)
  let crc = 0xffffffff
  for (let i = 4; i < result.length - 4; i++) crc = crcTable[(crc ^ result[i]!) & 255]! ^ (crc >>> 8)
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0)
  return result
}

/** 按输出条带顺序输入 RGB16，只保留一条带和压缩后的数据，避免整图额外展开。 */
export async function encodePng16(width: number, height: number, bands: AsyncIterable<Uint16Array>): Promise<Blob> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('PNG 尺寸无效。')
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 16
  header[9] = 2 // truecolor RGB
  const parts: BlobPart[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('sRGB', new Uint8Array([0]))]
  const stream = new CompressionStream('deflate')
  const writer = stream.writable.getWriter()
  // 必须并行读取，避免压缩流背压阻塞写入。
  const drained = (async () => {
    const reader = stream.readable.getReader()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        parts.push(chunk('IDAT', new Uint8Array(value)))
      }
    } finally { reader.releaseLock() }
  })()
  // producer 抛错或压缩流失败时都有消费者，避免未处理的 rejection。
  void drained.catch(() => {})
  let rows = 0
  try {
    for await (const band of bands) {
      const rowCount = band.length / (width * 3)
      if (!Number.isInteger(rowCount) || rows + rowCount > height) throw new Error('PNG 像素数量不匹配。')
      for (let y = 0; y < rowCount; y++) {
        const row = new Uint8Array(1 + width * 6)
        row[0] = 1 // Sub：渐变 RAW 比 None 更容易压缩
        const offset = y * width * 3
        for (let i = 0; i < width * 3; i++) {
          const value = band[offset + i]!
          const previous = i >= 3 ? band[offset + i - 3]! : 0
          row[1 + i * 2] = (value >>> 8) - (previous >>> 8)
          row[2 + i * 2] = (value & 255) - (previous & 255)
        }
        await writer.write(row)
      }
      rows += rowCount
    }
    if (rows !== height) throw new Error('PNG 像素数量不匹配。')
    await writer.close()
    await drained
  } catch (error) {
    await writer.abort(error).catch(() => {})
    await drained.catch(() => {})
    throw error
  } finally { writer.releaseLock() }
  parts.push(chunk('IEND', new Uint8Array()))
  return new Blob(parts, { type: 'image/png' })
}
