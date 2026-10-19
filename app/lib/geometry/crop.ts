import type { CropSpec, NormRect, PixelRect } from '../types'

/** 输出像素 → 原图像素的仿射变换：sx = a·ox + b·oy + c，sy = d·ox + e·oy + f */
export type Affine = readonly [number, number, number, number, number, number]

export const MAX_STRAIGHTEN_ANGLE = 45

export function defaultCrop(): CropSpec {
  return { rect: { x: 0, y: 0, w: 1, h: 1 }, angle: 0 }
}

export function isIdentityCrop(crop: CropSpec | null): boolean {
  if (!crop) {
    return true
  }
  const { rect, angle } = crop
  return angle === 0 && rect.x === 0 && rect.y === 0 && rect.w === 1 && rect.h === 1
}

/** 旋转后画布中的像素坐标 → 原图像素坐标（旋转中心为原图中心） */
export function rotatedToSource(px: number, py: number, angleDeg: number, imageW: number, imageH: number): [number, number] {
  const t = -angleDeg * Math.PI / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const cx = imageW / 2
  const cy = imageH / 2
  const dx = px - cx
  const dy = py - cy
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
}

export function cropCornersInSource(crop: CropSpec, imageW: number, imageH: number): Array<[number, number]> {
  const x0 = crop.rect.x * imageW
  const y0 = crop.rect.y * imageH
  const x1 = (crop.rect.x + crop.rect.w) * imageW
  const y1 = (crop.rect.y + crop.rect.h) * imageH
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => rotatedToSource(x!, y!, crop.angle, imageW, imageH))
}

/** 裁剪框四角映射回原图后是否都落在原图内（允许 eps 像素误差） */
export function isCropInside(crop: CropSpec, imageW: number, imageH: number, eps = 0.5): boolean {
  return cropCornersInSource(crop, imageW, imageH).every(([x, y]) =>
    x >= -eps && y >= -eps && x <= imageW + eps && y <= imageH + eps)
}

/**
 * 把裁剪框收进合法区域：沿“原图中心的零尺寸框 → 当前框”这条路径二分，
 * 找到仍然合法的最大框。旋转后原图中心总是合法，所以一定有解；框的长宽比保持不变。
 */
export function constrainCrop(crop: CropSpec, imageW: number, imageH: number): CropSpec {
  const angle = Math.max(-MAX_STRAIGHTEN_ANGLE, Math.min(MAX_STRAIGHTEN_ANGLE, crop.angle))
  const rect = clampNormRect(crop.rect)
  const candidate: CropSpec = { rect, angle }
  if (isCropInside(candidate, imageW, imageH)) {
    return candidate
  }
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const at = (s: number): CropSpec => {
    const w = rect.w * s
    const h = rect.h * s
    const ccx = 0.5 + (cx - 0.5) * s
    const ccy = 0.5 + (cy - 0.5) * s
    return { rect: { x: ccx - w / 2, y: ccy - h / 2, w, h }, angle }
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (isCropInside(at(mid), imageW, imageH, 0)) {
      lo = mid
    } else {
      hi = mid
    }
  }
  return at(lo)
}

/**
 * 按目标长宽比（输出像素宽/高）生成以当前框中心为锚点、尽可能大的合法裁剪框；
 * aspect 为 null 时只做合法化。
 */
export function applyCropAspect(crop: CropSpec, aspect: number | null, imageW: number, imageH: number): CropSpec {
  if (!aspect) {
    return constrainCrop(crop, imageW, imageH)
  }
  let w = imageW
  let h = w / aspect
  if (h > imageH) {
    h = imageH
    w = h * aspect
  }
  const cx = crop.rect.x + crop.rect.w / 2
  const cy = crop.rect.y + crop.rect.h / 2
  const nw = w / imageW
  const nh = h / imageH
  const rect = {
    x: Math.min(1 - nw, Math.max(0, cx - nw / 2)),
    y: Math.min(1 - nh, Math.max(0, cy - nh / 2)),
    w: nw,
    h: nh
  }
  return constrainCrop({ rect, angle: crop.angle }, imageW, imageH)
}

export function cropOutputSize(crop: CropSpec | null, imageW: number, imageH: number): { w: number, h: number } {
  if (!crop) {
    return { w: imageW, h: imageH }
  }
  return {
    w: Math.max(1, Math.round(crop.rect.w * imageW)),
    h: Math.max(1, Math.round(crop.rect.h * imageH))
  }
}

export function outputToSourceAffine(crop: CropSpec | null, imageW: number, imageH: number): Affine {
  if (!crop) {
    return [1, 0, 0, 0, 1, 0]
  }
  const t = -crop.angle * Math.PI / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const cx = imageW / 2
  const cy = imageH / 2
  const ox = crop.rect.x * imageW - cx
  const oy = crop.rect.y * imageH - cy
  return [
    cos, -sin, cx + ox * cos - oy * sin,
    sin, cos, cy + ox * sin + oy * cos
  ]
}

export function applyAffine(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]]
}

/** 输出像素矩形映射到原图后的外接框（不做裁剪） */
export function sourceBoundsOfOutputRect(m: Affine, rect: PixelRect): PixelRect {
  const corners = [
    applyAffine(m, rect.x, rect.y),
    applyAffine(m, rect.x + rect.w, rect.y),
    applyAffine(m, rect.x + rect.w, rect.y + rect.h),
    applyAffine(m, rect.x, rect.y + rect.h)
  ]
  const xs = corners.map(c => c[0])
  const ys = corners.map(c => c[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function clampNormRect(rect: NormRect): NormRect {
  const w = Math.min(1, Math.max(0.01, rect.w))
  const h = Math.min(1, Math.max(0.01, rect.h))
  return {
    x: Math.min(1 - w, Math.max(0, rect.x)),
    y: Math.min(1 - h, Math.max(0, rect.y)),
    w,
    h
  }
}
