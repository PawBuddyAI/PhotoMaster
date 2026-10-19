import { canvasToBlob, createCanvas, get2d, pixelsToCanvas, readCanvasPixels, scaleToFit } from '../image/canvas'
import { rasterizeMask } from '../mask/rasterize'
import type { MaskSpec, PixelRect } from '../types'
import { matchColorToSurroundings } from './colorMatch'
import { buildPatch, compositeOver } from './composite'
import { buildEditRegion, inpaintMargins } from './regions'

export interface FinalizeInput {
  /** 模型输出（编辑分辨率） */
  generated: Blob
  /** 底图在裁剪区域内的原始内容（原图分辨率，尺寸 = crop.w × crop.h） */
  originalCrop: ImageBitmap
  mask: MaskSpec
  imageW: number
  imageH: number
  crop: PixelRect
}

export interface FinalizeOutput {
  /** RGBA PNG 补丁，alpha 为羽化蒙版 */
  patch: Blob
  /** 合成后的裁剪区域缩略图（JPEG），用于候选对比 */
  preview: Blob
  colorCorrected: boolean
}

/**
 * 处理一张候选结果：缩放回原图分辨率 → 环带色彩匹配 → 以羽化蒙版为 alpha 生成补丁。
 * 在 Worker 中运行，避免大图逐像素运算阻塞界面。
 */
export async function finalizeCandidate(input: FinalizeInput): Promise<FinalizeOutput> {
  const { crop } = input
  const generatedBitmap = await createImageBitmap(input.generated)
  const generatedCanvas = createCanvas(crop.w, crop.h)
  const ctx = get2d(generatedCanvas, true)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(generatedBitmap, 0, 0, crop.w, crop.h)
  generatedBitmap.close()
  const generated = readCanvasPixels(generatedCanvas)

  const originalCanvas = createCanvas(crop.w, crop.h)
  get2d(originalCanvas, true).drawImage(input.originalCrop, 0, 0)
  input.originalCrop.close()
  const original = readCanvasPixels(originalCanvas)

  const mask = rasterizeMask(input.mask, input.imageW, input.imageH, crop, crop.w, crop.h)
  const editRegion = buildEditRegion(mask, crop.w, crop.h)
  const { ringWidth } = inpaintMargins(crop.w, crop.h)
  const matched = matchColorToSurroundings(generated, original, editRegion, crop.w, crop.h, { ringWidth })
  const patchPixels = buildPatch(matched.pixels, mask)

  const patch = await canvasToBlob(pixelsToCanvas(patchPixels, crop.w, crop.h), 'image/png')
  const composited = pixelsToCanvas(compositeOver(original, patchPixels), crop.w, crop.h)
  const preview = await canvasToBlob(scaleToFit(composited, crop.w, crop.h, 768), 'image/jpeg', 0.85)
  return { patch, preview, colorCorrected: matched.applied }
}
