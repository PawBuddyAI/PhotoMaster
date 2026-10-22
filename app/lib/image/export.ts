import { cropOutputSize, outputToSourceAffine, sourceBoundsOfOutputRect, type Affine } from '../geometry/crop'
import { blurPadding, PhotoRenderer } from '../pipeline/renderer'
import { type AdjustInput, buildRenderLayers } from '../pipeline/layers'
import type { CropSpec, PixelRect } from '../types'
import { canvasToBlob, createCanvas, decodeImage, get2d } from './canvas'
import { composeBase, type PatchSource } from './compose'
import { insertExif, prepareExportExif } from './exif'
import { composeLinear, linearInfo, readLinearRegion } from './high-depth'
import { normalizeHdr, type HdrSettings } from './hdr'
import { encodeExr } from './exr'
import { encodeUltraHdr, pqBands } from './hdr-export'
import { encodePng16 } from './png16'
import { rasterizeMaskFloat } from '../mask/rasterize'

export type ExportFormat = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/x-exr' | 'image/ultrahdr' | 'image/png-hdr'

export interface ExportPatch {
  blob: Blob
  x: number
  y: number
  w: number
  h: number
}

export interface ExportInput {
  original: Blob
  /** RAW 高精度线性底图；original 只供 EXIF / AI / 显示兼容。 */
  linear?: Blob
  hdr?: HdrSettings
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
  let original: ImageBitmap | undefined
  let renderer: PhotoRenderer | undefined
  const patches: PatchSource[] = []
  const decodedPatches: ImageBitmap[] = []
  try {
    original = input.linear ? undefined : await decodeImage(input.original)
    const info = input.linear ? await linearInfo(input.linear) : undefined
    const { width: imageW, height: imageH } = info ?? original!
    const floatOutput = ['image/x-exr', 'image/ultrahdr', 'image/png-hdr'].includes(input.format)
    if (floatOutput && !info?.hdr) throw new Error('HDR 导出需要浮点 HDR 工程，请重新导入原始 RAW。')
    const settings = normalizeHdr(input.hdr)
    // 顺序解码，任何一步失败时 finally 都能释放之前已加载的位图。
    for (const p of input.patches) {
      const image = await decodeImage(p.blob)
      decodedPatches.push(image)
      patches.push({ image, x: p.x, y: p.y, w: p.w, h: p.h })
    }
    const out = cropOutputSize(input.crop, imageW, imageH)
    const affine = outputToSourceAffine(input.crop, imageW, imageH)
    const longSide = Math.max(imageW, imageH)
    const pad = blurPadding(longSide) + 2
    renderer = new PhotoRenderer(createCanvas(1, 1), !!input.linear, !!info?.hdr)
    const gpu = renderer
    // 块加上两侧边距和对齐余量后不能超过纹理上限
    const rotationScale = Math.max(Math.abs(affine[0]) + Math.abs(affine[1]), Math.abs(affine[3]) + Math.abs(affine[4]))
    const maxTile = Math.floor((gpu.maxTextureSize - 2 * pad - 2 * TILE_ALIGN) / rotationScale / TILE_ALIGN) * TILE_ALIGN
    if (maxTile < TILE_ALIGN) throw new Error('图像尺寸超过当前 GPU 的分块处理能力。')
    const tileSize = Math.max(TILE_ALIGN, Math.floor(Math.min(input.tileSize ?? (input.linear ? 1024 : 2048), maxTile)))
    const tilesX = Math.ceil(out.w / tileSize)
    const tilesY = Math.ceil(out.h / tileSize)
    const total = tilesX * tilesY

    const highDepthOutput = !!input.linear && input.format === 'image/png'
    const output = highDepthOutput || floatOutput ? undefined : createCanvas(out.w, out.h)
    const outCtx = output ? get2d(output) : undefined
    let done = 0
    async function* renderBands(): AsyncGenerator<Uint16Array | Float32Array> {
      for (let ty = 0; ty < out.h; ty += tileSize) {
        const bandH = Math.min(tileSize, out.h - ty)
        const channels = floatOutput ? 4 : 3
        const band = floatOutput ? new Float32Array(out.w * bandH * 4) : highDepthOutput ? new Uint16Array(out.w * bandH * 3) : undefined
        for (let tx = 0; tx < out.w; tx += tileSize) {
          const tile: PixelRect = { x: tx, y: ty, w: Math.min(tileSize, out.w - tx), h: bandH }
          const region = sourceRegionForTile(affine, tile, pad, imageW, imageH)
          if (input.linear) {
            const base = composeLinear(await readLinearRegion(input.linear, region, region.w, region.h), patches, region)
            gpu.setLinearSource(base.data, base.width, base.height)
          } else {
            gpu.setSource(composeBase(original!, patches, region, region.w, region.h), region.w, region.h)
          }
          const layers = buildRenderLayers(input.layers, imageW, imageH, region, region.w, region.h, `tile-${tx}-${ty}`,
            input.linear ? spec => rasterizeMaskFloat(spec, imageW, imageH, region, region.w, region.h) : undefined)
          gpu.process(layers, longSide)
          const transform = tileAffine(affine, tile, region)
          if (band) {
            const pixels = floatOutput ? gpu.readLinearPixels(tile.w, tile.h, transform) : gpu.readPixels16(tile.w, tile.h, transform)
            for (let y = 0; y < tile.h; y++) band.set(pixels.subarray(y * tile.w * channels, (y + 1) * tile.w * channels), (y * out.w + tx) * channels)
          } else {
            outCtx!.putImageData(new ImageData(gpu.readPixels(tile.w, tile.h, transform), tile.w, tile.h), tile.x, tile.y)
          }
          done++
          onProgress?.(done, total)
        }
        if (band) yield band
      }
    }
    let blob: Blob
    if (floatOutput) {
      const bands = renderBands() as AsyncIterable<Float32Array>
      blob = input.format === 'image/x-exr'
        ? await encodeExr(out.w, out.h, bands, settings.referenceWhite)
        : input.format === 'image/png-hdr'
          ? await encodePng16(out.w, out.h, pqBands(bands, settings), true)
          : await encodeUltraHdr(out.w, out.h, bands, settings, input.quality)
    } else if (highDepthOutput) {
      blob = await encodePng16(out.w, out.h, renderBands() as AsyncIterable<Uint16Array>)
    } else {
      for await (const _band of renderBands()) { /* 8 位结果直接写入输出画布 */ }
      blob = await canvasToBlob(output!, input.format, input.quality)
    }
    if (input.keepExif && input.format === 'image/jpeg') {
      const exif = await prepareExportExif(input.original, out.w, out.h)
      if (exif) {
        blob = await insertExif(blob, exif)
      }
    }
    return { blob, width: out.w, height: out.h }
  } finally {
    renderer?.dispose()
    original?.close()
    decodedPatches.forEach(image => image.close())
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
