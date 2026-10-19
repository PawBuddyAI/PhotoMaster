import type { PixelRect } from '../types'
import { type AnyCanvas, createCanvas, get2d } from './canvas'

/** 已解码的生成补丁及其在原图像素坐标中的位置 */
export interface PatchSource {
  image: CanvasImageSource
  x: number
  y: number
  w: number
  h: number
}

/**
 * 合成“底图”（原图 + 按顺序叠加的生成补丁）在 region 范围内的内容，输出 outW×outH。
 * 预览底图、重绘输入、分块导出都走这里；比例为 1:1 时原图像素按原样拷贝，
 * 补丁 alpha 为 0 的位置不会改变任何像素。
 */
export function composeBase(
  original: CanvasImageSource,
  patches: PatchSource[],
  region: PixelRect,
  outW: number,
  outH: number
): AnyCanvas {
  const canvas = createCanvas(outW, outH)
  const ctx = get2d(canvas)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // 带透明通道的输入（PNG/WebP）按白底展平
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, outW, outH)
  const sx = outW / region.w
  const sy = outH / region.h
  ctx.drawImage(original, region.x, region.y, region.w, region.h, 0, 0, outW, outH)
  for (const patch of patches) {
    if (patch.x >= region.x + region.w || patch.y >= region.y + region.h
      || patch.x + patch.w <= region.x || patch.y + patch.h <= region.y) {
      continue
    }
    ctx.drawImage(patch.image, (patch.x - region.x) * sx, (patch.y - region.y) * sy, patch.w * sx, patch.h * sy)
  }
  return canvas
}
