/** TIFF 标签值：数组按 type 编码（5 / 10 为有理数），字符串为 ASCII，Buffer 原样写入（UNDEFINED） */
export interface TiffValue {
  type: number
  values: number[] | string | Buffer
}
export type TiffTags = Record<number, TiffValue>

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
  /** 内嵌 JPEG 预览：按 DNG 的常见布局，IFD0 放预览，原始图像放进 SubIFD */
  preview?: { jpeg: Buffer, width: number, height: number }
  /** 追加到原始图像 IFD 的标签（OpcodeList、DefaultCrop、ActiveArea 等） */
  raw?: TiffTags
  /** 追加到 IFD0 的标签（BaselineExposure、拍摄时间、作者等） */
  ifd0?: TiffTags
  /** Exif / GPS 子 IFD */
  exif?: TiffTags
  gps?: TiffTags
}

interface Ifd {
  tags: TiffTags
  children?: Record<number, Ifd[]>
  data?: Buffer
}

const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 10: 8, 11: 4, 12: 8 }

function encode(value: TiffValue): Buffer {
  if (typeof value.values === 'string') return Buffer.from(`${value.values}\0`, 'latin1')
  if (Buffer.isBuffer(value.values)) return value.values
  const size = SIZE[value.type]!
  const bytes = Buffer.alloc(value.values.length * size)
  value.values.forEach((v, i) => {
    const o = i * size
    if (value.type === 1 || value.type === 7) bytes.writeUInt8(v, o)
    else if (value.type === 3) bytes.writeUInt16LE(v, o)
    else if (value.type === 4) bytes.writeUInt32LE(v, o)
    else if (value.type === 5) {
      bytes.writeUInt32LE(Math.round(v * 10000), o)
      bytes.writeUInt32LE(10000, o + 4)
    } else if (value.type === 10) {
      bytes.writeInt32LE(Math.round(v * 10000), o)
      bytes.writeInt32LE(10000, o + 4)
    } else if (value.type === 11) bytes.writeFloatLE(v, o)
    else bytes.writeDoubleLE(v, o)
  })
  return bytes
}

/** 小端 TIFF：子 IFD（SubIFDs / Exif / GPS 指针）与条带数据紧跟在各自的 IFD 之后 */
export function writeTiff(root: Ifd): Buffer {
  let size = 8
  const reserve = (bytes: number) => {
    size = (size + 1) & ~1
    const offset = size
    size += bytes
    return offset
  }
  const pending: Array<{ offset: number, bytes: Buffer }> = []
  const place = (ifd: Ifd): number => {
    const entries = new Map<number, { type: number, count: number, bytes: Buffer }>()
    for (const [tag, value] of Object.entries(ifd.tags)) {
      const bytes = encode(value)
      const count = typeof value.values === 'string' ? value.values.length + 1 : Buffer.isBuffer(value.values) ? value.values.length : value.values.length
      entries.set(Number(tag), { type: value.type, count, bytes })
    }
    for (const [tag, list] of Object.entries(ifd.children ?? {})) entries.set(Number(tag), { type: 4, count: list.length, bytes: Buffer.alloc(4 * list.length) })
    if (ifd.data) {
      entries.set(273, { type: 4, count: 1, bytes: Buffer.alloc(4) })
      entries.set(279, { type: 4, count: 1, bytes: encode({ type: 4, values: [ifd.data.length] }) })
    }
    const sorted = [...entries.entries()].sort((a, b) => a[0] - b[0])
    const start = reserve(2 + sorted.length * 12 + 4)
    const offsets = new Map<number, number>()
    for (const [tag, entry] of sorted) {
      if (entry.bytes.length > 4 && !(tag in (ifd.children ?? {}))) {
        offsets.set(tag, reserve(entry.bytes.length))
        pending.push({ offset: offsets.get(tag)!, bytes: entry.bytes })
      }
    }
    for (const [tag, list] of Object.entries(ifd.children ?? {})) {
      const entry = entries.get(Number(tag))!
      list.map(place).forEach((offset, i) => entry.bytes.writeUInt32LE(offset, i * 4))
      if (entry.bytes.length > 4) {
        offsets.set(Number(tag), reserve(entry.bytes.length))
        pending.push({ offset: offsets.get(Number(tag))!, bytes: entry.bytes })
      }
    }
    if (ifd.data) {
      const offset = reserve(ifd.data.length)
      entries.get(273)!.bytes.writeUInt32LE(offset)
      pending.push({ offset, bytes: ifd.data })
    }
    const head = Buffer.alloc(2 + sorted.length * 12 + 4)
    head.writeUInt16LE(sorted.length, 0)
    sorted.forEach(([tag, entry], i) => {
      const at = 2 + i * 12
      head.writeUInt16LE(tag, at)
      head.writeUInt16LE(entry.type, at + 2)
      head.writeUInt32LE(entry.count, at + 4)
      if (offsets.has(tag)) head.writeUInt32LE(offsets.get(tag)!, at + 8)
      else entry.bytes.copy(head, at + 8)
    })
    pending.push({ offset: start, bytes: head })
    return start
  }
  const first = place(root)
  const result = Buffer.alloc(size)
  result.write('II')
  result.writeUInt16LE(42, 2)
  result.writeUInt32LE(first, 4)
  for (const { offset, bytes } of pending) bytes.copy(result, offset)
  return result
}

/** DNG OpcodeList（整体大端序） */
export function opcodeList(ops: Array<{ id: number, params: Buffer, optional?: boolean }>): TiffValue {
  const parts = [Buffer.alloc(4)]
  parts[0]!.writeUInt32BE(ops.length)
  for (const op of ops) {
    const head = Buffer.alloc(16)
    head.writeUInt32BE(op.id, 0)
    head.writeUInt32BE(0x01030000, 4)
    head.writeUInt32BE(op.optional ? 1 : 0, 8)
    head.writeUInt32BE(op.params.length, 12)
    parts.push(head, op.params)
  }
  return { type: 7, values: Buffer.concat(parts) }
}

/** 大端参数：u32 / f64 / f32 */
export function bigEndian(spec: Array<['u32' | 'f64' | 'f32', number]>): Buffer {
  const bytes = Buffer.alloc(spec.reduce((sum, [type]) => sum + (type === 'f64' ? 8 : 4), 0))
  let offset = 0
  for (const [type, value] of spec) {
    if (type === 'u32') bytes.writeUInt32BE(value, offset)
    else if (type === 'f32') bytes.writeFloatBE(value, offset)
    else bytes.writeDoubleBE(value, offset)
    offset += type === 'f64' ? 8 : 4
  }
  return bytes
}

/** GainMap（opcode 9）参数；gains 按 [行][列][平面] 排列，map 点均匀铺满整幅图像 */
export function gainMap(area: { top: number, left: number, bottom: number, right: number }, options: { plane?: number, planes?: number, pitch?: number, points: [number, number], mapPlanes?: number, gains: number[] }): Buffer {
  const [pointsV, pointsH] = options.points
  return bigEndian([
    ['u32', area.top], ['u32', area.left], ['u32', area.bottom], ['u32', area.right],
    ['u32', options.plane ?? 0], ['u32', options.planes ?? 1], ['u32', options.pitch ?? 1], ['u32', options.pitch ?? 1],
    ['u32', pointsV], ['u32', pointsH],
    ['f64', 1 / Math.max(1, pointsV - 1)], ['f64', 1 / Math.max(1, pointsH - 1)], ['f64', 0], ['f64', 0],
    ['u32', options.mapPlanes ?? 1],
    ...options.gains.map(g => ['f32', g] as ['f32', number])
  ])
}

/** WarpRectilinear（opcode 1）：每个平面 [kr0, kr1, kr2, kr3, kt0, kt1] */
export function warpRectilinear(planes: number[][], cx = 0.5, cy = 0.5): Buffer {
  return bigEndian([['u32', planes.length], ...planes.flat().map(v => ['f64', v] as ['f64', number]), ['f64', cx], ['f64', cy]])
}

/** FixVignetteRadial（opcode 3）：增益 1 + k0·r² + … */
export function fixVignetteRadial(k: number[], cx = 0.5, cy = 0.5): Buffer {
  return bigEndian([...[0, 1, 2, 3, 4].map(i => ['f64', k[i] ?? 0] as ['f64', number]), ['f64', cx], ['f64', cy]])
}

/** 自行生成的未压缩 Bayer DNG：无需下载照片，测试走真实 LibRaw 解码。 */
export function makeDng(orientation = 1, options: DngOptions = {}): Buffer {
  const width = options.width ?? 128
  const height = options.height ?? 96
  const pixel = options.pixel ?? ((x: number, y: number) => 4000 + Math.round(44000 * x / width) + Math.round(8000 * y / height))
  const data = Buffer.alloc(width * height * 2)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = Math.max(0, Math.min(65535, Math.round(pixel(x, y, [[0, 1], [1, 2]][y & 1]![x & 1]!))))
      data.writeUInt16LE(value, (y * width + x) * 2)
    }
  }
  const rawTags: TiffTags = {
    256: { type: 4, values: [width] },
    257: { type: 4, values: [height] },
    258: { type: 3, values: [16] },
    259: { type: 3, values: [options.compression ?? 1] },
    262: { type: 3, values: [32803] },
    277: { type: 3, values: [1] },
    278: { type: 4, values: [height] },
    284: { type: 3, values: [1] },
    33421: { type: 3, values: [2, 2] },
    33422: { type: 1, values: [0, 1, 1, 2] },
    50710: { type: 1, values: [0, 1, 2] },
    50711: { type: 3, values: [1] },
    50714: { type: 5, values: [options.black ?? 0] },
    50717: { type: 4, values: [options.white ?? 65535] },
    ...options.raw
  }
  const dngTags: TiffTags = {
    271: { type: 2, values: 'PhotoMaster' },
    272: { type: 2, values: 'Synthetic DNG' },
    274: { type: 3, values: [orientation] },
    50706: { type: 1, values: [1, 4, 0, 0] },
    50707: { type: 1, values: [1, 1, 0, 0] },
    50708: { type: 2, values: 'PhotoMaster Synthetic DNG' },
    50721: { type: 10, values: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    50728: { type: 5, values: options.neutral ?? [1, 1, 1] },
    50778: { type: 3, values: [21] },
    ...options.ifd0
  }
  const children: Record<number, Ifd[]> = {}
  if (options.exif) children[34665] = [{ tags: options.exif }]
  if (options.gps) children[34853] = [{ tags: options.gps }]
  if (!options.preview) return writeTiff({ tags: { ...dngTags, ...rawTags }, data, children })
  const { jpeg, width: pw, height: ph } = options.preview
  return writeTiff({
    tags: {
      ...dngTags,
      254: { type: 4, values: [1] },
      256: { type: 4, values: [pw] },
      257: { type: 4, values: [ph] },
      258: { type: 3, values: [8, 8, 8] },
      259: { type: 3, values: [7] },
      262: { type: 3, values: [6] },
      277: { type: 3, values: [3] },
      278: { type: 4, values: [ph] },
      284: { type: 3, values: [1] }
    },
    data: jpeg,
    children: { ...children, 330: [{ tags: { 254: { type: 4, values: [0] }, ...rawTags }, data }] }
  })
}
