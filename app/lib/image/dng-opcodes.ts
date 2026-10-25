import UTIF from 'utif2'

/**
 * DNG 的镜头与传感器校正（规范 1.3+ 的 OpcodeList）。LibRaw 不应用这些 opcode，这里只解析参数，
 * 由 raw-geometry.ts 在逐像素采样时施加。坐标都相对 ActiveArea（即 LibRaw 未旋转的输出）。
 */
export interface GainMapOp {
  kind: 'gain'
  top: number
  left: number
  bottom: number
  right: number
  plane: number
  planes: number
  rowPitch: number
  colPitch: number
  pointsV: number
  pointsH: number
  spacingV: number
  spacingH: number
  originV: number
  originH: number
  mapPlanes: number
  /** [行][列][平面] */
  gains: Float32Array
}

/** 输出像素 → 输入像素的径向 + 切向畸变；每个平面 [kr0, kr1, kr2, kr3, kt0, kt1]，中心为相对坐标 */
export interface WarpOp {
  kind: 'warp'
  planes: number[][]
  cx: number
  cy: number
}

/** 增益 = 1 + k0·r² + k1·r⁴ + k2·r⁶ + k3·r⁸ + k4·r¹⁰ */
export interface VignetteOp {
  kind: 'vignette'
  k: number[]
  cx: number
  cy: number
}

export type DngOpcode = GainMapOp | WarpOp | VignetteOp

export interface DngCorrections {
  /** ActiveArea 尺寸；与 LibRaw 输出不一致时不能套用坐标 */
  width: number
  height: number
  /** OpcodeList2：去马赛克之前的增益图 */
  before: GainMapOp[]
  /** OpcodeList3：去马赛克之后，按列表顺序施加 */
  after: DngOpcode[]
  /** DefaultCrop，相对 ActiveArea */
  crop: { x: number, y: number, w: number, h: number } | null
  /** 已识别但不支持、被跳过的 opcode 编号（只用于日志） */
  skipped: number[]
}

const OPCODE_WARP_RECTILINEAR = 1
const OPCODE_FIX_VIGNETTE_RADIAL = 3
const OPCODE_GAIN_MAP = 9

/** OpcodeList 一律为大端序：数量，然后每项 id、版本、标志、参数长度、参数 */
export function parseOpcodeList(bytes: Uint8Array): { ops: DngOpcode[], skipped: number[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ops: DngOpcode[] = []
  const skipped: number[] = []
  if (bytes.byteLength < 4) return { ops, skipped }
  const count = view.getUint32(0)
  let p = 4
  for (let i = 0; i < count && p + 16 <= bytes.byteLength; i++) {
    const id = view.getUint32(p)
    const size = view.getUint32(p + 12)
    const q = p + 16
    p = q + size
    if (p > bytes.byteLength) break
    const op = id === OPCODE_GAIN_MAP
      ? parseGainMap(view, q, size)
      : id === OPCODE_WARP_RECTILINEAR
        ? parseWarp(view, q, size)
        : id === OPCODE_FIX_VIGNETTE_RADIAL ? parseVignette(view, q, size) : null
    if (op === 'identity') continue
    if (op) ops.push(op)
    else skipped.push(id)
  }
  return { ops, skipped }
}

function parseGainMap(view: DataView, q: number, size: number): GainMapOp | null {
  if (size < 76) return null
  const u = (k: number) => view.getUint32(q + k * 4)
  const d = (k: number) => view.getFloat64(q + 40 + k * 8)
  const pointsV = u(8)
  const pointsH = u(9)
  const mapPlanes = view.getUint32(q + 72)
  const total = pointsV * pointsH * mapPlanes
  if (!pointsV || !pointsH || !mapPlanes || size < 76 + total * 4 || !(d(0) > 0) || !(d(1) > 0)) return null
  const gains = new Float32Array(total)
  for (let i = 0; i < total; i++) gains[i] = view.getFloat32(q + 76 + i * 4)
  if (!gains.every(Number.isFinite)) return null
  return {
    kind: 'gain', top: u(0), left: u(1), bottom: u(2), right: u(3), plane: u(4), planes: Math.max(1, u(5)),
    rowPitch: Math.max(1, u(6)), colPitch: Math.max(1, u(7)), pointsV, pointsH,
    spacingV: d(0), spacingH: d(1), originV: d(2), originH: d(3), mapPlanes, gains
  }
}

function parseWarp(view: DataView, q: number, size: number): WarpOp | 'identity' | null {
  if (size < 4) return null
  const planes = view.getUint32(q)
  if (!planes || size < 4 + planes * 48 + 16) return null
  const coefficients = Array.from({ length: planes }, (_, i) => Array.from({ length: 6 }, (_, k) => view.getFloat64(q + 4 + (i * 6 + k) * 8)))
  const cx = view.getFloat64(q + 4 + planes * 48)
  const cy = view.getFloat64(q + 12 + planes * 48)
  if (![...coefficients.flat(), cx, cy].every(Number.isFinite)) return null
  // 恒等变换（Pixel 等手机常带一个可选的空 warp）不需要施加，避免无谓的重采样
  if (coefficients.every(c => c[0] === 1 && c.slice(1).every(v => v === 0))) return 'identity'
  return { kind: 'warp', planes: coefficients, cx, cy }
}

function parseVignette(view: DataView, q: number, size: number): VignetteOp | null {
  if (size < 56) return null
  const values = Array.from({ length: 7 }, (_, k) => view.getFloat64(q + k * 8))
  if (!values.every(Number.isFinite) || values.slice(0, 5).every(v => v === 0)) return null
  return { kind: 'vignette', k: values.slice(0, 5), cx: values[5]!, cy: values[6]! }
}

type Ifd = Record<string, unknown> & { subIFD?: Ifd[] }

/** utif2 的标签值：BYTE 为 Uint8Array，有理数为 [分子, 分母]，其余为数组 */
function numbers(value: unknown): number[] {
  if (value instanceof Uint8Array) return Array.from(value)
  if (!Array.isArray(value)) return []
  return value.map(v => Array.isArray(v) ? v[0] / v[1] : Number(v))
}

/** 原始图像 IFD：NewSubFileType 为 0、光度解释为 CFA 或 LinearRaw，取最大的一个 */
function rawIfd(ifds: Ifd[]): Ifd | null {
  let best: Ifd | null = null
  let bestArea = 0
  const visit = (list: Ifd[]) => {
    for (const ifd of list) {
      const type = numbers(ifd.t254)[0] ?? 0
      const photometric = numbers(ifd.t262)[0]
      const area = (numbers(ifd.t256)[0] ?? 0) * (numbers(ifd.t257)[0] ?? 0)
      if (type === 0 && (photometric === 32803 || photometric === 34892) && area > bestArea) {
        best = ifd
        bestArea = area
      }
      if (ifd.subIFD) visit(ifd.subIFD)
    }
  }
  visit(ifds)
  return best
}

/** 读 DNG 的校正参数；不是 DNG、结构异常时返回 null（按无校正处理，不影响解码）。 */
export function readDngCorrections(file: ArrayBuffer): DngCorrections | null {
  // 只解析标准 TIFF 头（DNG 一定是）；CR3、RAF、ORF、RW2 等头部不同，直接跳过
  const head = new Uint8Array(file, 0, Math.min(4, file.byteLength))
  const tiff = (head[0] === 0x49 && head[1] === 0x49 && head[2] === 42 && head[3] === 0)
    || (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0 && head[3] === 42)
  if (!tiff) return null
  let ifds: Ifd[]
  try {
    ifds = (UTIF.decode as (buffer: ArrayBuffer, prm: { parseMN: boolean, debug: boolean }) => Ifd[])(file, { parseMN: false, debug: false })
  } catch {
    return null
  }
  if (!ifds.length || !numbers(ifds[0]!.t50706).length) return null
  const raw = rawIfd(ifds)
  if (!raw) return null
  const area = numbers(raw.t50829)
  const width = area.length === 4 ? area[3]! - area[1]! : numbers(raw.t256)[0] ?? 0
  const height = area.length === 4 ? area[2]! - area[0]! : numbers(raw.t257)[0] ?? 0
  const list = (tag: unknown) => tag instanceof Uint8Array ? parseOpcodeList(tag) : { ops: [], skipped: [] }
  const before = list(raw.t51009)
  const after = list(raw.t51022)
  const origin = numbers(raw.t50719)
  const size = numbers(raw.t50720)
  let crop: DngCorrections['crop'] = null
  if (origin.length === 2 && size.length === 2) {
    const [x, y] = origin.map(Math.round) as [number, number]
    const [w, h] = size.map(Math.round) as [number, number]
    if (x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= width && y + h <= height && (w < width || h < height)) crop = { x, y, w, h }
  }
  return {
    width,
    height,
    before: before.ops.filter((op): op is GainMapOp => op.kind === 'gain'),
    after: after.ops,
    crop,
    skipped: [...before.skipped, ...after.skipped, ...before.ops.filter(op => op.kind !== 'gain').map(op => op.kind === 'warp' ? OPCODE_WARP_RECTILINEAR : OPCODE_FIX_VIGNETTE_RADIAL)]
  }
}
