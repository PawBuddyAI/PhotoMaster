import { cropOutputSize, outputToSourceAffine, sourceBoundsOfOutputRect, type Affine } from '../geometry/crop'
import { blurPadding, PhotoRenderer } from '../pipeline/renderer'
import { type AdjustInput, buildRenderLayers } from '../pipeline/layers'
import type { CropSpec, PixelRect } from '../types'
import { canvasToBlob, createCanvas, decodeImage, get2d } from './canvas'
import { composeBase, type PatchSource } from './compose'
import { insertExif, prepareExportExif } from './exif'

export type ExportFormat = 'image/jpeg' | 'image/png' | 'image/webp'

export interface ExportPatch {
  blob: Blob
  x: number
  y: number
  w: number
  h: number
}

export interface ExportInput {
  original: Blob
  patches: ExportPatch[]
  /** 已启用的调整图层，按渲染顺序 */
  layers: AdjustInput[]
  crop: CropSpec | null
  format: ExportFormat
  /** 0–1，仅 JPEG/WebP 有效 */
  quality: number
  keepExif: boolean
  tileSize?: number
}

export interface ExportResult {
  blob: Blob
  width: number
  height: number
}

/** 分块起点对齐到 64 像素，保证各块内逐级降采样的网格一致，避免模糊结果在块边界出现接缝 */
const TILE_ALIGN = 64

/**
 * 全分辨率导出：按输出分块，每块取其在原图中的外接区域（加模糊所需边距），
 * 合成底图 → 栅格化蒙版 → GPU 调色 → 按裁剪/旋转重采样读回，最后拼成整图编码。
 * 显存占用只与块大小有关，与原图尺寸无关。
 */
export async function renderExport(input: ExportInput, onProgress?: (done: number, total: number) => void): Promise<ExportResult> {
  const original = await decodeImage(input.original)
  const imageW = original.width
  const imageH = original.height
  const patchBitmaps = await Promise.all(input.patches.map(async p => ({ ...p, image: await decodeImage(p.blob) })))
  const patches: PatchSource[] = patchBitmaps.map(p => ({ image: p.image, x: p.x, y: p.y, w: p.w, h: p.h }))

  const out = cropOutputSize(input.crop, imageW, imageH)
  const affine = outputToSourceAffine(input.crop, imageW, imageH)
  const longSide = Math.max(imageW, imageH)
  const pad = blurPadding(longSide) + 2

  const renderer = new PhotoRenderer(createCanvas(1, 1))
  try {
    // 块加上两侧边距和对齐余量后不能超过纹理上限
    const maxTile = Math.floor((renderer.maxTextureSize - 2 * pad - 2 * TILE_ALIGN) / TILE_ALIGN) * TILE_ALIGN
    const tileSize = Math.max(TILE_ALIGN, Math.min(input.tileSize ?? 2048, maxTile))
    const tilesX = Math.ceil(out.w / tileSize)
    const tilesY = Math.ceil(out.h / tileSize)
    const total = tilesX * tilesY

    const output = createCanvas(out.w, out.h)
    const outCtx = get2d(output)
    let done = 0
    for (let ty = 0; ty < out.h; ty += tileSize) {
      for (let tx = 0; tx < out.w; tx += tileSize) {
        const tile: PixelRect = { x: tx, y: ty, w: Math.min(tileSize, out.w - tx), h: Math.min(tileSize, out.h - ty) }
        const region = sourceRegionForTile(affine, tile, pad, imageW, imageH)
        const base = composeBase(original, patches, region, region.w, region.h)
        const layers = buildRenderLayers(input.layers, imageW, imageH, region, region.w, region.h, `tile-${tx}-${ty}`)
        renderer.setSource(base, region.w, region.h)
        renderer.process(layers, longSide)
        const pixels = renderer.readPixels(tile.w, tile.h, tileAffine(affine, tile, region))
        outCtx.putImageData(new ImageData(pixels, tile.w, tile.h), tile.x, tile.y)
        done++
        onProgress?.(done, total)
      }
    }

    let blob = await canvasToBlob(output, input.format, input.quality)
    if (input.keepExif && input.format === 'image/jpeg') {
      const exif = await prepareExportExif(input.original, out.w, out.h)
      if (exif) {
        blob = await insertExif(blob, exif)
      }
    }
    return { blob, width: out.w, height: out.h }
  } finally {
    renderer.dispose()
    original.close()
    patchBitmaps.forEach(p => p.image.close())
  }
}

/** 输出块在原图中的整数外接区域：外扩边距、起点按 TILE_ALIGN 对齐、裁剪到原图范围 */
export function sourceRegionForTile(affine: Affine, tile: PixelRect, pad: number, imageW: number, imageH: number): PixelRect {
  const bounds = sourceBoundsOfOutputRect(affine, tile)
  const x0 = Math.max(0, Math.floor((bounds.x - pad) / TILE_ALIGN) * TILE_ALIGN)
  const y0 = Math.max(0, Math.floor((bounds.y - pad) / TILE_ALIGN) * TILE_ALIGN)
  const x1 = Math.min(imageW, Math.ceil(bounds.x + bounds.w + pad))
  const y1 = Math.min(imageH, Math.ceil(bounds.y + bounds.h + pad))
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}

/** 块内像素坐标 → 区域内像素坐标 */
export function tileAffine(affine: Affine, tile: PixelRect, region: PixelRect): Affine {
  const [a, b, c, d, e, f] = affine
  return [
    a, b, a * tile.x + b * tile.y + c - region.x,
    d, e, d * tile.x + e * tile.y + f - region.y
  ]
}
