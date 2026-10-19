import type { BrushStroke, MaskSpec, PixelRect } from '../types'

/**
 * 把 MaskSpec 栅格化为 outW×outH 的单通道蒙版（0–255），覆盖原图像素坐标中的 region。
 * 预览、全分辨率分块导出、OpenAI 编辑尺寸都调用这一实现，保证各分辨率下区域一致。
 * 纯 TS 实现，可在主线程、Worker 和 node 测试中运行。
 */
export function rasterizeMask(
  spec: MaskSpec,
  imageW: number,
  imageH: number,
  region: PixelRect,
  outW: number,
  outH: number
): Uint8Array {
  const values = new Float32Array(outW * outH)
  const ctx: RasterContext = {
    imageW,
    imageH,
    region,
    outW,
    outH,
    sx: region.w / outW,
    sy: region.h / outH
  }

  fillShape(values, spec, ctx)
  if (spec.invert) {
    for (let i = 0; i < values.length; i++) {
      values[i] = 1 - values[i]!
    }
  }
  for (const stroke of spec.strokes) {
    applyStroke(values, stroke, ctx)
  }

  const density = Math.min(1, Math.max(0, spec.density))
  const out = new Uint8Array(values.length)
  for (let i = 0; i < values.length; i++) {
    const v = values[i]! * density
    out[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255)
  }
  return out
}

interface RasterContext {
  imageW: number
  imageH: number
  region: PixelRect
  outW: number
  outH: number
  /** 每个输出像素对应的原图像素数 */
  sx: number
  sy: number
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function fillShape(values: Float32Array, spec: MaskSpec, ctx: RasterContext): void {
  switch (spec.shape) {
    case 'full':
      values.fill(1)
      return
    case 'none':
      return
    case 'rect':
      fillRect(values, spec, ctx)
      return
    case 'ellipse':
      fillEllipse(values, spec, ctx)
      return
    case 'linear':
      fillLinear(values, spec, ctx)
  }
}

function fillRect(values: Float32Array, spec: MaskSpec, ctx: RasterContext): void {
  const { imageW, imageH, region, outW, outH, sx, sy } = ctx
  const rx = spec.rect.x * imageW
  const ry = spec.rect.y * imageH
  const rw = spec.rect.w * imageW
  const rh = spec.rect.h * imageH
  const feather = Math.max(0, spec.feather) * Math.min(rw, rh) / 2
  // 羽化宽度小于一个输出像素时退化为抗锯齿硬边
  const aa = Math.max(sx, sy)
  // 贴住图像边界的边不做羽化，否则会在照片边缘产生暗角/亮边
  const edge = 1e-4
  const openLeft = spec.rect.x <= edge
  const openTop = spec.rect.y <= edge
  const openRight = spec.rect.x + spec.rect.w >= 1 - edge
  const openBottom = spec.rect.y + spec.rect.h >= 1 - edge
  for (let j = 0; j < outH; j++) {
    const y = region.y + (j + 0.5) * sy
    const dy = Math.min(openTop ? Infinity : y - ry, openBottom ? Infinity : ry + rh - y)
    if (dy < -aa) {
      continue
    }
    const row = j * outW
    for (let i = 0; i < outW; i++) {
      const x = region.x + (i + 0.5) * sx
      const d = Math.min(dy, openLeft ? Infinity : x - rx, openRight ? Infinity : rx + rw - x)
      values[row + i] = feather > aa
        ? (d <= 0 ? 0 : smoothstep(0, feather, d))
        : Math.min(1, Math.max(0, d / aa + 0.5))
    }
  }
}

function fillEllipse(values: Float32Array, spec: MaskSpec, ctx: RasterContext): void {
  const { imageW, imageH, region, outW, outH, sx, sy } = ctx
  const a = spec.rect.w * imageW / 2
  const b = spec.rect.h * imageH / 2
  if (a <= 0 || b <= 0) {
    return
  }
  const cx = spec.rect.x * imageW + a
  const cy = spec.rect.y * imageH + b
  // 一个输出像素在归一化半径上的宽度，用于硬边抗锯齿
  const aaR = Math.max(sx, sy) / Math.min(a, b)
  const soft = Math.max(Math.min(1, Math.max(0, spec.feather)), aaR)
  const inner = 1 - soft
  for (let j = 0; j < outH; j++) {
    const ny = (region.y + (j + 0.5) * sy - cy) / b
    if (Math.abs(ny) > 1 + aaR) {
      continue
    }
    const row = j * outW
    for (let i = 0; i < outW; i++) {
      const nx = (region.x + (i + 0.5) * sx - cx) / a
      const r = Math.sqrt(nx * nx + ny * ny)
      values[row + i] = r >= 1 ? 0 : 1 - smoothstep(inner, 1, r)
    }
  }
}

function fillLinear(values: Float32Array, spec: MaskSpec, ctx: RasterContext): void {
  const { imageW, imageH, region, outW, outH, sx, sy } = ctx
  const x0 = spec.line.x0 * imageW
  const y0 = spec.line.y0 * imageH
  const dx = spec.line.x1 * imageW - x0
  const dy = spec.line.y1 * imageH - y0
  const len2 = Math.max(dx * dx + dy * dy, 1e-6)
  for (let j = 0; j < outH; j++) {
    const py = region.y + (j + 0.5) * sy - y0
    const row = j * outW
    for (let i = 0; i < outW; i++) {
      const px = region.x + (i + 0.5) * sx - x0
      const t = (px * dx + py * dy) / len2
      values[row + i] = 1 - smoothstep(0, 1, t)
    }
  }
}

/**
 * 画笔笔画：沿折线按间距盖章，同一笔画内取覆盖率最大值（避免叠加变深），
 * 再以 source-over 方式合成到蒙版上：add 推向 1，erase 推向 0，先后顺序得以保留。
 */
function applyStroke(values: Float32Array, stroke: BrushStroke, ctx: RasterContext): void {
  const { imageW, imageH, region, outW, outH, sx, sy } = ctx
  const pointCount = Math.floor(stroke.points.length / 2)
  if (pointCount === 0 || stroke.radius <= 0) {
    return
  }
  const longSide = Math.max(imageW, imageH)
  const rx = stroke.radius * longSide / sx
  const ry = stroke.radius * longSide / sy

  const xs = new Float64Array(pointCount)
  const ys = new Float64Array(pointCount)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let k = 0; k < pointCount; k++) {
    const x = (stroke.points[2 * k]! * imageW - region.x) / sx
    const y = (stroke.points[2 * k + 1]! * imageH - region.y) / sy
    xs[k] = x
    ys[k] = y
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  const bx0 = Math.max(0, Math.floor(minX - rx))
  const by0 = Math.max(0, Math.floor(minY - ry))
  const bx1 = Math.min(outW, Math.ceil(maxX + rx))
  const by1 = Math.min(outH, Math.ceil(maxY + ry))
  if (bx1 <= bx0 || by1 <= by0) {
    return
  }
  const bw = bx1 - bx0
  const bh = by1 - by0
  const coverage = new Float32Array(bw * bh)

  // 柔边宽度（归一化半径单位）至少一个像素，保证硬笔刷也有抗锯齿
  const softWidth = Math.max(1 - Math.min(1, Math.max(0, stroke.hardness)), 1 / Math.max(1, Math.min(rx, ry)))
  const softStart = 1 - softWidth

  const stamp = (cx: number, cy: number) => {
    const x0 = Math.max(bx0, Math.floor(cx - rx))
    const x1 = Math.min(bx1, Math.ceil(cx + rx))
    const y0 = Math.max(by0, Math.floor(cy - ry))
    const y1 = Math.min(by1, Math.ceil(cy + ry))
    for (let y = y0; y < y1; y++) {
      const ny = (y + 0.5 - cy) / ry
      const row = (y - by0) * bw
      for (let x = x0; x < x1; x++) {
        const nx = (x + 0.5 - cx) / rx
        const d = Math.sqrt(nx * nx + ny * ny)
        if (d >= 1) {
          continue
        }
        const c = 1 - smoothstep(softStart, 1, d)
        const idx = row + x - bx0
        if (c > coverage[idx]!) {
          coverage[idx] = c
        }
      }
    }
  }

  const spacing = Math.max(0.5, Math.min(rx, ry) * 0.2)
  stamp(xs[0]!, ys[0]!)
  for (let k = 1; k < pointCount; k++) {
    const ax = xs[k - 1]!
    const ay = ys[k - 1]!
    const segX = xs[k]! - ax
    const segY = ys[k]! - ay
    const len = Math.hypot(segX, segY)
    const steps = Math.max(1, Math.ceil(len / spacing))
    for (let s = 1; s <= steps; s++) {
      stamp(ax + segX * s / steps, ay + segY * s / steps)
    }
  }

  const target = stroke.mode === 'add' ? 1 : 0
  for (let y = 0; y < bh; y++) {
    const srcRow = y * bw
    const dstRow = (y + by0) * outW + bx0
    for (let x = 0; x < bw; x++) {
      const c = coverage[srcRow + x]!
      if (c > 0) {
        const idx = dstRow + x
        values[idx] = values[idx]! * (1 - c) + target * c
      }
    }
  }
}
