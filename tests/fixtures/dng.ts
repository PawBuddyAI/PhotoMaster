export interface DngOptions {
  neutral?: number[]
  black?: number
  white?: number
  width?: number
  height?: number
  /** TIFF Compression；声明成解码器不支持的值（如 52546 JPEG XL）时，像素仍按未压缩写入 */
  compression?: number
  /** RGGB 阵列上每个样本的原始值；channel 0 / 1 / 2 为 R / G / B */
  pixel?: (x: number, y: number, channel: number) => number
}

/** 自行生成的未压缩 Bayer DNG：无需下载照片，测试走真实 LibRaw 解码。 */
export function makeDng(orientation = 1, options: DngOptions = {}): Buffer {
  const width = options.width ?? 128
  const height = options.height ?? 96
  const pixel = options.pixel ?? ((x: number, y: number) => 4000 + Math.round(44000 * x / width) + Math.round(8000 * y / height))
  type Entry = { tag: number, type: number, count: number, bytes: Buffer }
  const entries: Entry[] = []
  const add = (tag: number, type: number, values: number[] | string) => {
    const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 } as Record<number, number>)[type]!
    if (typeof values === 'string') {
      entries.push({ tag, type, count: values.length + 1, bytes: Buffer.from(`${values}\0`) })
      return
    }
    const bytes = Buffer.alloc(values.length * size)
    values.forEach((value, i) => {
      if (type === 1) bytes.writeUInt8(value, i)
      else if (type === 3) bytes.writeUInt16LE(value, i * size)
      else if (type === 4) bytes.writeUInt32LE(value, i * size)
      else {
        bytes.writeInt32LE(Math.round(value * 10000), i * size)
        bytes.writeInt32LE(10000, i * size + 4)
      }
    })
    entries.push({ tag, type, count: values.length, bytes })
  }
  add(256, 4, [width])
  add(257, 4, [height])
  add(258, 3, [16])
  add(259, 3, [options.compression ?? 1])
  add(262, 3, [32803])
  add(271, 2, 'PhotoMaster')
  add(272, 2, 'Synthetic DNG')
  add(273, 4, [0])
  add(274, 3, [orientation])
  add(277, 3, [1])
  add(278, 4, [height])
  add(279, 4, [width * height * 2])
  add(284, 3, [1])
  add(33421, 3, [2, 2])
  add(33422, 1, [0, 1, 1, 2])
  add(50706, 1, [1, 4, 0, 0])
  add(50707, 1, [1, 1, 0, 0])
  add(50708, 2, 'PhotoMaster Synthetic DNG')
  add(50710, 1, [0, 1, 2])
  add(50711, 3, [1])
  add(50714, 5, [options.black ?? 0])
  add(50717, 4, [options.white ?? 65535])
  add(50721, 10, [1, 0, 0, 0, 1, 0, 0, 0, 1])
  add(50728, 5, options.neutral ?? [1, 1, 1])
  add(50778, 3, [21])
  entries.sort((a, b) => a.tag - b.tag)
  let offset = 8 + 2 + entries.length * 12 + 4
  const extraSize = entries.reduce((sum, e) => sum + (e.bytes.length > 4 ? (e.bytes.length + 1) & ~1 : 0), 0)
  const pixelsOffset = offset + extraSize
  entries.find(e => e.tag === 273)!.bytes.writeUInt32LE(pixelsOffset)
  const result = Buffer.alloc(pixelsOffset + width * height * 2)
  result.write('II')
  result.writeUInt16LE(42, 2)
  result.writeUInt32LE(8, 4)
  result.writeUInt16LE(entries.length, 8)
  entries.forEach((entry, i) => {
    const start = 10 + i * 12
    result.writeUInt16LE(entry.tag, start)
    result.writeUInt16LE(entry.type, start + 2)
    result.writeUInt32LE(entry.count, start + 4)
    if (entry.bytes.length <= 4) entry.bytes.copy(result, start + 8)
    else {
      result.writeUInt32LE(offset, start + 8)
      entry.bytes.copy(result, offset)
      offset += (entry.bytes.length + 1) & ~1
    }
  })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      result.writeUInt16LE(pixel(x, y, [[0, 1], [1, 2]][y & 1]![x & 1]!), pixelsOffset + (y * width + x) * 2)
    }
  }
  return result
}
