import type { PixelRect } from '../types'

/** OpenAI GPT Image（gpt-image-2 及以后）对自定义尺寸的约束 */
export const OPENAI_SIZE_LIMITS = {
  multiple: 16,
  maxAspect: 3,
  minPixels: 655_360,
  maxPixels: 8_294_400,
  maxSide: 3840
} as const

/** 所有 GPT Image 模型都支持的固定尺寸，供不支持自定义尺寸的模型或兼容服务使用 */
export const FIXED_SIZES: ReadonlyArray<readonly [number, number]> = [
  [1024, 1024],
  [1536, 1024],
  [1024, 1536]
]

/** 自定义尺寸模式下成本上限（最长边）的最小可选值：保证 3:1 时仍满足最小像素数 */
export const MIN_CUSTOM_LONG_SIDE = 1536

export interface SizingOptions {
  mode: 'custom' | 'fixed'
  /** 自定义模式下编辑分辨率的最长边上限（控制成本） */
  maxLongSide: number
  /** 上下文边距占蒙版外接框尺寸的比例 */
  padRatio?: number
  /** 上下文边距最小像素数 */
  minPad?: number
}

export interface EditPlan {
  /** 原图像素坐标中的裁剪区域（整数） */
  crop: PixelRect
  /** 发送给 OpenAI 的图像尺寸 */
  outW: number
  outH: number
  /** 裁剪区域与输出尺寸的长宽比偏差（理想情况下接近 0；无法避免时才会明显大于 0） */
  distortion: number
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 规划一次局部重绘：在蒙版外接框四周扩出上下文边距，调整到合法长宽比，
 * 再计算满足 OpenAI 尺寸约束的编辑分辨率，并反向微调裁剪框使比例一致（不拉伸）。
 */
export function planEditRegion(maskBox: PixelRect, imageW: number, imageH: number, opts: SizingOptions): EditPlan {
  if (maskBox.w <= 0 || maskBox.h <= 0) {
    throw new Error('蒙版区域为空，无法规划重绘区域')
  }
  const padRatio = opts.padRatio ?? 0.5
  const minPad = opts.minPad ?? 128
  const padX = Math.max(minPad, maskBox.w * padRatio)
  const padY = Math.max(minPad, maskBox.h * padRatio)
  const image: Box = { x: 0, y: 0, w: imageW, h: imageH }

  let box = clampBox({
    x: maskBox.x - padX,
    y: maskBox.y - padY,
    w: maskBox.w + 2 * padX,
    h: maskBox.h + 2 * padY
  }, image)

  let outW: number
  let outH: number
  if (opts.mode === 'fixed') {
    const [fw, fh] = pickFixedSize(box.w / box.h)
    outW = fw
    outH = fh
    box = fitAspect(box, outW / outH, maskBox, image)
  } else {
    const aspect = clamp(box.w / box.h, 1 / OPENAI_SIZE_LIMITS.maxAspect, OPENAI_SIZE_LIMITS.maxAspect)
    box = fitAspect(box, aspect, maskBox, image)
    const size = customOutputSize(box.w, box.h, opts.maxLongSide)
    outW = size.w
    outH = size.h
    // 取整到 16 的倍数会让比例略有变化，再按最终比例微调一次裁剪框
    box = fitAspect(box, outW / outH, maskBox, image)
  }

  const crop = roundBox(box, outW / outH, image)
  const distortion = Math.abs((crop.w / crop.h) / (outW / outH) - 1)
  return { crop, outW, outH, distortion }
}

/**
 * 自定义尺寸：不放大原图区域（放大只会增加成本，结果最终仍缩回原尺寸），超过成本上限或像素上限时缩小；
 * 只有不足最小像素数时才放大，最后取整到 16 的倍数。
 */
export function customOutputSize(w: number, h: number, maxLongSide: number): { w: number, h: number } {
  const { multiple, minPixels, maxPixels, maxSide, maxAspect } = OPENAI_SIZE_LIMITS
  const longCap = Math.min(maxSide, Math.max(MIN_CUSTOM_LONG_SIDE, maxLongSide))
  const area = w * h
  let scale = Math.min(1, longCap / Math.max(w, h), Math.sqrt(maxPixels / area))
  if (area * scale * scale < minPixels) {
    scale = Math.sqrt(minPixels / area)
  }

  let outW = Math.max(multiple, Math.round(w * scale / multiple) * multiple)
  let outH = Math.max(multiple, Math.round(h * scale / multiple) * multiple)

  // 取整后逐项修正：比例 → 像素下限 → 像素上限 → 单边上限
  if (outW > outH * maxAspect) outW = Math.floor(outH * maxAspect / multiple) * multiple
  if (outH > outW * maxAspect) outH = Math.floor(outW * maxAspect / multiple) * multiple
  while (outW * outH < minPixels) {
    if (outW / outH < maxAspect && outW + multiple <= maxSide) {
      outW += multiple
    } else {
      outH += multiple
    }
  }
  while (outW * outH > maxPixels || outW > maxSide || outH > maxSide) {
    if (outW >= outH) {
      outW -= multiple
    } else {
      outH -= multiple
    }
  }
  return { w: outW, h: outH }
}

/** 在对数比例空间里挑选与目标长宽比最接近的固定尺寸 */
export function pickFixedSize(aspect: number): readonly [number, number] {
  let best = FIXED_SIZES[0]!
  let bestDiff = Infinity
  for (const size of FIXED_SIZES) {
    const diff = Math.abs(Math.log(size[0] / size[1]) - Math.log(aspect))
    if (diff < bestDiff) {
      best = size
      bestDiff = diff
    }
  }
  return best
}

/**
 * 把 box 调整到目标长宽比：优先扩展短的一边（获取更多上下文）；
 * 原图不够大时改为收缩长的一边，但始终包含蒙版外接框；两者都做不到时保留现状（由调用方接受轻微形变）。
 */
export function fitAspect(box: Box, aspect: number, mustContain: PixelRect, image: Box): Box {
  const current = box.w / box.h
  if (Math.abs(current / aspect - 1) < 1e-9) {
    return { ...box }
  }
  if (current < aspect) {
    const targetW = box.h * aspect
    if (targetW <= image.w) {
      return clampBox({ ...box, x: box.x + box.w / 2 - targetW / 2, w: targetW }, image)
    }
    const widened = { ...box, x: image.x, w: image.w }
    const targetH = widened.w / aspect
    if (targetH >= mustContain.h) {
      return { ...widened, ...placeSpan(box.y + box.h / 2, targetH, mustContain.y, mustContain.h, image.y, image.h, 'y') }
    }
    return widened
  }
  const targetH = box.w / aspect
  if (targetH <= image.h) {
    return clampBox({ ...box, y: box.y + box.h / 2 - targetH / 2, h: targetH }, image)
  }
  const heightened = { ...box, y: image.y, h: image.h }
  const targetW = heightened.h * aspect
  if (targetW >= mustContain.w) {
    return { ...heightened, ...placeSpan(box.x + box.w / 2, targetW, mustContain.x, mustContain.w, image.x, image.w, 'x') }
  }
  return heightened
}

/** 在一维上放置长度为 length 的区间：尽量以 center 为中心，同时包含必须区间并落在边界内 */
function placeSpan(
  center: number,
  length: number,
  keepStart: number,
  keepLength: number,
  boundStart: number,
  boundLength: number,
  axis: 'x' | 'y'
): Partial<Box> {
  const minStart = Math.max(boundStart, keepStart + keepLength - length)
  const maxStart = Math.min(boundStart + boundLength - length, keepStart)
  const start = clamp(center - length / 2, minStart, Math.max(minStart, maxStart))
  return axis === 'x' ? { x: start, w: length } : { y: start, h: length }
}

/** 把 box 平移进边界；超出边界的尺寸会被截断 */
function clampBox(box: Box, image: Box): Box {
  const w = Math.min(box.w, image.w)
  const h = Math.min(box.h, image.h)
  return {
    x: clamp(box.x, image.x, image.x + image.w - w),
    y: clamp(box.y, image.y, image.y + image.h - h),
    w,
    h
  }
}

/**
 * 取整为像素。高度只在 1 像素范围内按目标比例微调，长宽比误差因此不超过半个像素；
 * fitAspect 无法达到目标比例时保持原尺寸（宁可轻微形变也不裁掉蒙版）。
 */
function roundBox(box: Box, aspect: number, image: Box): PixelRect {
  const w = clamp(Math.round(box.w), 1, image.w)
  let h = clamp(Math.round(box.h), 1, image.h)
  const ideal = Math.round(w / aspect)
  if (Math.abs(ideal - box.h) <= 1 && ideal >= 1 && ideal <= image.h) {
    h = ideal
  }
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const x = clamp(Math.round(cx - w / 2), 0, image.w - w)
  const y = clamp(Math.round(cy - h / 2), 0, image.h - h)
  return { x, y, w, h }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
