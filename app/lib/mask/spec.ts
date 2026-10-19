import type { MaskShape, MaskSpec, NormRect, PixelRect } from '../types'

const DEFAULT_RECT: NormRect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }

/** 各形状的默认羽化：椭圆默认较大，接近径向渐变的观感 */
const DEFAULT_FEATHER: Record<MaskShape, number> = {
  full: 0,
  none: 0,
  rect: 0.3,
  ellipse: 0.6,
  linear: 0
}

export function createMaskSpec(shape: MaskShape, overrides: Partial<MaskSpec> = {}): MaskSpec {
  return {
    shape,
    rect: { ...DEFAULT_RECT },
    line: { x0: 0.5, y0: 0, x1: 0.5, y1: 0.5 },
    feather: DEFAULT_FEATHER[shape],
    invert: false,
    density: 1,
    strokes: [],
    ...overrides
  }
}

export function defaultFeather(shape: MaskShape): number {
  return DEFAULT_FEATHER[shape]
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** 把任意两个角点规范成落在 [0,1] 内、宽高非负的矩形 */
export function rectFromCorners(x0: number, y0: number, x1: number, y1: number): NormRect {
  const left = clamp01(Math.min(x0, x1))
  const top = clamp01(Math.min(y0, y1))
  const right = clamp01(Math.max(x0, x1))
  const bottom = clamp01(Math.max(y0, y1))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * 计算蒙版非零区域在原图像素坐标中的外接框；区域为空时返回 null。
 * 形状羽化向内收，所以形状的外接框就是它的影响范围。
 */
export function maskBoundsPx(spec: MaskSpec, imageW: number, imageH: number): PixelRect | null {
  if (spec.density <= 0) {
    return null
  }
  const fullImage: PixelRect = { x: 0, y: 0, w: imageW, h: imageH }
  let box: PixelRect | null = null

  const shapeCoversAll = spec.invert
    ? spec.shape !== 'full'
    : spec.shape === 'full' || spec.shape === 'linear'
  const shapeEmpty = spec.invert
    ? spec.shape === 'full'
    : spec.shape === 'none'

  if (shapeCoversAll) {
    return fullImage
  }
  if (!shapeEmpty && (spec.shape === 'rect' || spec.shape === 'ellipse')) {
    box = {
      x: spec.rect.x * imageW,
      y: spec.rect.y * imageH,
      w: spec.rect.w * imageW,
      h: spec.rect.h * imageH
    }
  }

  const longSide = Math.max(imageW, imageH)
  for (const stroke of spec.strokes) {
    if (stroke.mode !== 'add' || stroke.points.length < 2) {
      continue
    }
    const r = stroke.radius * longSide
    for (let i = 0; i + 1 < stroke.points.length; i += 2) {
      const px = stroke.points[i]! * imageW
      const py = stroke.points[i + 1]! * imageH
      box = unionRect(box, { x: px - r, y: py - r, w: 2 * r, h: 2 * r })
    }
  }

  if (!box) {
    return null
  }
  const clipped = intersectRect(box, fullImage)
  return clipped && clipped.w >= 1 && clipped.h >= 1 ? clipped : null
}

export function unionRect(a: PixelRect | null, b: PixelRect): PixelRect {
  if (!a) {
    return { ...b }
  }
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y
  }
}

export function intersectRect(a: PixelRect, b: PixelRect): PixelRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.w, b.x + b.w)
  const bottom = Math.min(a.y + a.h, b.y + b.h)
  if (right <= x || bottom <= y) {
    return null
  }
  return { x, y, w: right - x, h: bottom - y }
}

/** 全图满强度且没有笔画的蒙版无需栅格化，渲染时直接按全图处理 */
export function isFullMask(spec: MaskSpec): boolean {
  return spec.shape === 'full' && !spec.invert && spec.density >= 1 && spec.strokes.length === 0
}

/** 蒙版内容的稳定键，用于缓存栅格化结果 */
export function maskKey(spec: MaskSpec): string {
  return JSON.stringify(spec)
}
