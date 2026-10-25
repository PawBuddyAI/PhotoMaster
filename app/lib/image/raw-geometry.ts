import type { DngCorrections, DngOpcode, GainMapOp } from './dng-opcodes'

/** 未旋转坐标系（DNG 的阶段坐标，即 LibRaw 未旋转的输出）中的矩形 */
export interface StageRect { x: number, y: number, w: number, h: number }

export interface RawGeometryInput {
  /** LibRaw imageData：已按 flip 旋转、已裁到 ActiveArea 的相机空间样本 */
  data: Uint16Array
  width: number
  height: number
  colors: number
  /** LibRaw 的 flip：bit 4 交换行列，bit 2 翻转行，bit 1 翻转列（同 dcraw flip_index） */
  flip: number
  /** LibRaw filters：Bayer 阵列颜色，用于把去马赛克前的增益图对应到通道 */
  filters: number
  crop: StageRect | null
  corrections: Pick<DngCorrections, 'before' | 'after'> | null
}

export interface RawGeometry {
  /** 输出尺寸（裁剪后、已旋转） */
  width: number
  height: number
  /** 是否施加了 opcode（需要逐通道重采样） */
  corrected: boolean
  /** 输出像素 → 各通道原始样本（扣除黑电平后）与校正增益 */
  read: (pixel: number, samples: Float64Array, gains: Float64Array) => void
}

/** 输出坐标（像素中心为 i + 0.5）→ 未旋转坐标；iw / ih 为未旋转尺寸 */
export function toStage(flip: number, x: number, y: number, iw: number, ih: number): [number, number] {
  let [sy, sx] = flip & 4 ? [x, y] : [y, x]
  if (flip & 2) sy = ih - sy
  if (flip & 1) sx = iw - sx
  return [sx, sy]
}

/** toStage 的逆 */
export function fromStage(flip: number, x: number, y: number, iw: number, ih: number): [number, number] {
  const sx = flip & 1 ? iw - x : x
  const sy = flip & 2 ? ih - y : y
  return flip & 4 ? [sy, sx] : [sx, sy]
}

/** 光学中心与到四角的最远距离（DNG 用它把半径归一化到 0–1） */
function radial(cx: number, cy: number, iw: number, ih: number): { x: number, y: number, max: number } {
  const x = cx * iw
  const y = cy * ih
  return { x, y, max: Math.max(Math.hypot(x, y), Math.hypot(iw - x, y), Math.hypot(x, ih - y), Math.hypot(iw - x, ih - y)) }
}

/** dcraw 的 FC：Bayer 阵列 (row, col) 处的颜色；3 为第二个绿色 */
function bayerColor(filters: number, row: number, col: number): number {
  const color = (filters >>> ((((row << 1) & 14) | (col & 1)) << 1)) & 3
  return color === 3 ? 1 : color
}

/**
 * 逐像素读取：DefaultCrop、旋转、DNG opcode（暗角 / 色彩阴影增益、畸变与横向色差）合成一次重采样。
 * 输出像素先映射到未旋转坐标，再逆序经过 OpcodeList3（增益在当时的位置取值，warp 改变位置），
 * 最后在得到的位置取 OpcodeList2 的增益并以 Catmull-Rom 插值读取相机样本。没有 opcode 时逐样本直接拷贝。
 */
export function createRawGeometry(input: RawGeometryInput): RawGeometry {
  const { data, width, height, colors, flip } = input
  const iw = flip & 4 ? height : width
  const ih = flip & 4 ? width : height
  const crop = input.crop ?? { x: 0, y: 0, w: iw, h: ih }
  const outW = flip & 4 ? crop.h : crop.w
  const outH = flip & 4 ? crop.w : crop.h
  const after = input.corrections?.after ?? []
  // filters 为 0 是已去马赛克的 LinearRaw（按平面编号对应通道）；其余是马赛克传感器（单平面）
  const mosaic = input.filters !== 0
  const bayer = input.filters >= 1000
  const everyPixel = (op: GainMapOp) => op.rowPitch === 1 && op.colPitch === 1
  // 去马赛克前的增益图：作用于全部像素的对所有通道生效，按相位的只能在 Bayer 阵列上对应到颜色（X-Trans 等跳过）
  const before = (input.corrections?.before ?? []).filter(op => colors === 3 && (!mosaic || bayer || everyPixel(op)))
  const corrected = after.length > 0 || before.length > 0

  const swap = (flip & 4) !== 0
  const mirrorY = (flip & 2) !== 0
  const mirrorX = (flip & 1) !== 0

  if (!corrected) {
    return {
      width: outW,
      height: outH,
      corrected,
      read(pixel, samples, gains) {
        // 输出 → 裁剪内未旋转的整数坐标 → LibRaw 缓冲区（与 toStage / fromStage 相同，避免逐像素分配数组）
        const ox = pixel % outW
        const oy = (pixel - ox) / outW
        let ux = swap ? oy : ox
        let uy = swap ? ox : oy
        if (mirrorY) uy = crop.h - 1 - uy
        if (mirrorX) ux = crop.w - 1 - ux
        let bx = ux + crop.x
        let by = uy + crop.y
        if (mirrorX) bx = iw - 1 - bx
        if (mirrorY) by = ih - 1 - by
        const offset = ((swap ? bx : by) * width + (swap ? by : bx)) * colors
        for (let c = 0; c < colors; c++) {
          samples[c] = data[offset + c]!
          gains[c] = 1
        }
      }
    }
  }

  const steps = [...after].reverse().map(op => compile(op, iw, ih))
  // 没有 warp 时取样位置就是像素中心，直接读值；各平面系数不同的 warp（横向色差校正）要逐通道走一遍；
  // 其余情况各通道位置相同，插值权重只算一次
  const warped = after.some(op => op.kind === 'warp')
  const perPlane = after.some(op => op.kind === 'warp' && op.planes.length > 1 && op.planes.some(p => p.some((v, i) => v !== op.planes[0]![i])))
  // 去马赛克前的增益图按通道归属好；同一颜色的多个相位（两个绿）取平均
  const beforeOps = Array.from({ length: colors }, (_, c) => before
    .filter(op => mosaic ? everyPixel(op) || bayerColor(input.filters, op.top, op.left) === c : c >= op.plane && c < op.plane + op.planes))
  const beforeMaps = beforeOps.map(ops => ops.map(op => compileGainMap(op, iw, ih)))
  const beforePlanes = beforeOps.map((ops, c) => Int32Array.from(ops, op => Math.min(Math.max(0, c - op.plane), op.mapPlanes - 1)))
  // 逐像素的浮点中间量都经这个数组传递：V8 在未内联的调用里会把浮点参数、返回值装箱成堆对象，频繁触发垃圾回收。
  // [0, 1] 未旋转坐标，[2, 3] 缓冲区坐标，[4] 增益图取值
  const point = new Float64Array(5)

  /** 沿逆序的 OpcodeList3 求取样位置（就地改 point[0, 1]）；channel 为 -1 时各通道共用，增益分通道累乘 */
  const chain = (channel: number, gains: Float64Array) => {
    let x = point[0]!
    let y = point[1]!
    for (let s = 0; s < steps.length; s++) {
      const step = steps[s]!
      if (step.kind === 'warp') {
        const k = step.planes
        const base = Math.min(Math.max(channel, 0), step.count - 1) * 6
        const dx = (x - step.cx) * step.inverse
        const dy = (y - step.cy) * step.inverse
        const r2 = dx * dx + dy * dy
        const f = k[base]! + r2 * (k[base + 1]! + r2 * (k[base + 2]! + r2 * k[base + 3]!))
        const kt0 = k[base + 4]!
        const kt1 = k[base + 5]!
        x = step.cx + step.max * (f * dx + kt0 * 2 * dx * dy + kt1 * (r2 + 2 * dx * dx))
        y = step.cy + step.max * (f * dy + kt1 * 2 * dx * dy + kt0 * (r2 + 2 * dy * dy))
      } else if (step.kind === 'vignette') {
        const vx = x - step.cx
        const vy = y - step.cy
        const r2 = (vx * vx + vy * vy) * step.inverse2
        const k = step.k
        const g = 1 + r2 * (k[0]! + r2 * (k[1]! + r2 * (k[2]! + r2 * (k[3]! + r2 * k[4]!))))
        for (let c = 0; c < colors; c++) if (channel < 0 || c === channel) gains[c]! *= g
      } else if (x >= step.left && x < step.right && y >= step.top && y < step.bottom) {
        point[0] = x
        point[1] = y
        for (let c = 0; c < colors; c++) {
          if ((channel >= 0 && c !== channel) || c < step.plane || c >= step.plane + step.planes) continue
          step.sample(point, Math.min(c - step.plane, step.mapPlanes - 1))
          gains[c]! *= point[4]!
        }
      }
    }
    point[0] = x
    point[1] = y
  }

  /** 去马赛克前的增益图：在最终取样位置（point[0, 1]）取值，同一颜色的多个相位取平均 */
  const applyBefore = (channel: number, gains: Float64Array) => {
    const maps = beforeMaps[channel]!
    const planes = beforePlanes[channel]!
    const x = point[0]!
    const y = point[1]!
    let total = 0
    let count = 0
    for (let i = 0; i < maps.length; i++) {
      const map = maps[i]!
      if (x < map.left || x >= map.right || y < map.top || y >= map.bottom) continue
      map.sample(point, planes[i]!)
      total += point[4]!
      count++
    }
    if (count) gains[channel]! *= total / count
  }
  /** 未旋转连续坐标 point[0, 1] → 缓冲区连续坐标 point[2, 3]（像素中心为整数） */
  const toBuffer = () => {
    const x = mirrorX ? iw - point[0]! : point[0]!
    const y = mirrorY ? ih - point[1]! : point[1]!
    point[2] = (swap ? y : x) - 0.5
    point[3] = (swap ? x : y) - 0.5
  }

  return {
    width: outW,
    height: outH,
    corrected,
    read(pixel, samples, gains) {
      const ox = pixel % outW
      const oy = (pixel - ox) / outW
      let ux = (swap ? oy : ox) + 0.5
      let uy = (swap ? ox : oy) + 0.5
      if (mirrorY) uy = crop.h - uy
      if (mirrorX) ux = crop.w - ux
      ux += crop.x
      uy += crop.y
      for (let c = 0; c < colors; c++) gains[c] = 1
      if (perPlane) {
        for (let c = 0; c < colors; c++) {
          point[0] = ux
          point[1] = uy
          chain(c, gains)
          applyBefore(c, gains)
          toBuffer()
          sampleCubic(data, width, height, colors, c, 1, point, samples)
        }
        return
      }
      point[0] = ux
      point[1] = uy
      chain(-1, gains)
      for (let c = 0; c < colors; c++) applyBefore(c, gains)
      toBuffer()
      if (warped) {
        sampleCubic(data, width, height, colors, 0, colors, point, samples)
        return
      }
      const offset = (Math.floor(point[3]! + 0.5) * width + Math.floor(point[2]! + 0.5)) * colors
      for (let c = 0; c < colors; c++) samples[c] = data[offset + c]!
    }
  }
}

/** 增益图的作用范围与平面拷成平铺字段，逐像素访问时少一层对象 */
interface CompiledGainMap {
  left: number
  right: number
  top: number
  bottom: number
  plane: number
  planes: number
  mapPlanes: number
  /** 在 point[0, 1] 处取 plane 平面的增益，写入 point[4] */
  sample: (point: Float64Array, plane: number) => void
}

/**
 * 编译后的 OpcodeList3 一步。warp：输出 → 输入，dx、dy 为按到最远角距离归一化的偏移，
 * 源位置 = 中心 + max·(f·d + 切向项)，f = kr0 + kr1·r² + kr2·r⁴ + kr3·r⁶；vignette：增益 1 + Σ kᵢ·r^(2i+2)。
 */
type CompiledStep
  = | { kind: 'warp', planes: Float64Array, count: number, cx: number, cy: number, max: number, inverse: number }
    | { kind: 'vignette', k: Float64Array, cx: number, cy: number, inverse2: number }
    | ({ kind: 'gain' } & CompiledGainMap)

/** 预先算好中心、归一化半径与增益图的坐标换算，逐像素只剩乘加 */
function compile(op: DngOpcode, iw: number, ih: number): CompiledStep {
  if (op.kind === 'gain') return { kind: 'gain', ...compileGainMap(op, iw, ih) }
  const c = radial(op.cx, op.cy, iw, ih)
  if (op.kind === 'warp') return { kind: 'warp', planes: Float64Array.from(op.planes.flat()), count: op.planes.length, cx: c.x, cy: c.y, max: c.max, inverse: 1 / c.max }
  return { kind: 'vignette', k: Float64Array.from(op.k), cx: c.x, cy: c.y, inverse2: 1 / (c.max * c.max) }
}

function compileGainMap(op: GainMapOp, iw: number, ih: number): CompiledGainMap {
  const sv = 1 / (ih * op.spacingV)
  const sh = 1 / (iw * op.spacingH)
  const ov = op.originV / op.spacingV
  const oh = op.originH / op.spacingH
  const lastV = op.pointsV - 1
  const lastH = op.pointsH - 1
  const { gains, pointsH, mapPlanes } = op
  return {
    left: op.left,
    right: op.right,
    top: op.top,
    bottom: op.bottom,
    plane: op.plane,
    planes: op.planes,
    mapPlanes,
    sample(point, plane) {
      const fv = Math.min(lastV, Math.max(0, point[1]! * sv - ov))
      const fh = Math.min(lastH, Math.max(0, point[0]! * sh - oh))
      const v0 = Math.min(Math.max(0, lastV - 1), Math.floor(fv))
      const h0 = Math.min(Math.max(0, lastH - 1), Math.floor(fh))
      const v1 = Math.min(lastV, v0 + 1)
      const h1 = Math.min(lastH, h0 + 1)
      const tv = fv - v0
      const th = fh - h0
      const a = gains[(v0 * pointsH + h0) * mapPlanes + plane]!
      const b = gains[(v0 * pointsH + h1) * mapPlanes + plane]!
      const c = gains[(v1 * pointsH + h0) * mapPlanes + plane]!
      const d = gains[(v1 * pointsH + h1) * mapPlanes + plane]!
      point[4] = (a + (b - a) * th) * (1 - tv) + (c + (d - c) * th) * tv
    }
  }
}

/**
 * Catmull-Rom 双三次插值（point[2, 3] 为缓冲区内以像素中心为整数的坐标），权重算一次、依次取 first 起的 count 个通道写入 out；
 * 内部像素不做边界判断，结果不小于 0。
 */
function sampleCubic(data: Uint16Array, width: number, height: number, colors: number, first: number, count: number, point: Float64Array, out: Float64Array): void {
  const fx = point[2]!
  const fy = point[3]!
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const tx2 = tx * tx
  const ty2 = ty * ty
  const wx0 = 0.5 * (-tx2 * tx + 2 * tx2 - tx)
  const wx1 = 0.5 * (3 * tx2 * tx - 5 * tx2 + 2)
  const wx2 = 0.5 * (-3 * tx2 * tx + 4 * tx2 + tx)
  const wx3 = 0.5 * (tx2 * tx - tx2)
  const wy0 = 0.5 * (-ty2 * ty + 2 * ty2 - ty)
  const wy1 = 0.5 * (3 * ty2 * ty - 5 * ty2 + 2)
  const wy2 = 0.5 * (-3 * ty2 * ty + 4 * ty2 + ty)
  const wy3 = 0.5 * (ty2 * ty - ty2)
  const interior = x0 >= 1 && y0 >= 1 && x0 + 2 < width && y0 + 2 < height
  for (let channel = first; channel < first + count; channel++) {
    let sum = 0
    if (interior) {
      const stride = width * colors
      const c2 = 2 * colors
      const c3 = 3 * colors
      const p0 = ((y0 - 1) * width + x0 - 1) * colors + channel
      const p1 = p0 + stride
      const p2 = p1 + stride
      const p3 = p2 + stride
      sum = wy0 * (wx0 * data[p0]! + wx1 * data[p0 + colors]! + wx2 * data[p0 + c2]! + wx3 * data[p0 + c3]!)
        + wy1 * (wx0 * data[p1]! + wx1 * data[p1 + colors]! + wx2 * data[p1 + c2]! + wx3 * data[p1 + c3]!)
        + wy2 * (wx0 * data[p2]! + wx1 * data[p2 + colors]! + wx2 * data[p2 + c2]! + wx3 * data[p2 + c3]!)
        + wy3 * (wx0 * data[p3]! + wx1 * data[p3 + colors]! + wx2 * data[p3 + c2]! + wx3 * data[p3 + c3]!)
    } else {
      const wx = [wx0, wx1, wx2, wx3]
      const wy = [wy0, wy1, wy2, wy3]
      for (let j = 0; j < 4; j++) {
        const row = Math.min(height - 1, Math.max(0, y0 - 1 + j)) * width
        let line = 0
        for (let i = 0; i < 4; i++) line += wx[i]! * data[(row + Math.min(width - 1, Math.max(0, x0 - 1 + i))) * colors + channel]!
        sum += wy[j]! * line
      }
    }
    out[channel] = sum > 0 ? sum : 0
  }
}
