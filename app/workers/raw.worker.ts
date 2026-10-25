import LibRaw, { type Metadata } from 'libraw-wasm'
import { RAW_MAX_PIXELS, RAW_MAX_PIXELS_LABEL, RAW_SETTINGS, type RawDecoded } from '../lib/image/raw-settings'
import { linearToSrgb8, packFloatLinear } from '../lib/image/high-depth'
import { mapRgbInto, rec2020ToSrgb, rec2020ToSrgbInto } from '../lib/image/hdr'
import { rawColorTransform } from '../lib/image/raw-color'
import { describeRawFailure, RAW_CONVERT_HINT, RAW_UNRECOGNIZED, RawImportError, undecodableReason } from '../lib/image/raw-errors'
import { readDngCorrections } from '../lib/image/dng-opcodes'
import { createRawGeometry, type StageRect } from '../lib/image/raw-geometry'
import { buildRawProfile, createSceneCollector, createTileCollector, defaultRawDevelop, resolveLook } from '../lib/image/raw-develop'
import { renderSdr } from '../lib/image/raw-look'
import { estimateNoise } from '../lib/image/raw-noise'
import { PREVIEW_ANALYSIS_SIDE, readPreview } from '../lib/image/raw-meta'

const THUMBNAIL_SIDE = 480
const OPCODE_NAMES = { gain: 'GainMap', warp: 'WarpRectilinear', vignette: 'FixVignetteRadial' } as const

/** 非 DNG 的有效画面（LibRaw 从厂商信息读出，坐标相对整幅 RAW），换算到输出坐标；无效时为 null */
function makerCrop(meta: Metadata, iw: number, ih: number): StageRect | null {
  const crop = meta.raw_inset_crops?.[0]
  if (!crop || crop.cwidth <= 0 || crop.cheight <= 0 || crop.cleft === 65535 || crop.ctop === 65535) return null
  const x = crop.cleft - meta.left_margin
  const y = crop.ctop - meta.top_margin
  if (x < 0 || y < 0 || x + crop.cwidth > iw || y + crop.cheight > ih || (crop.cwidth === iw && crop.cheight === ih)) return null
  return { x, y, w: crop.cwidth, h: crop.cheight }
}

// LibRaw 自身的 Worker 解码；本 Worker 负责校正、像素转换、分析和编码，避免阻塞界面。
self.onmessage = async ({ data: file }: MessageEvent<File>) => {
  const decoder = new LibRaw()
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    // open 会转移缓冲区，先读出 DNG 的校正参数
    const dng = readDngCorrections(bytes.buffer)
    await decoder.open(bytes, RAW_SETTINGS)
    // 认不出的文件 open 也会成功，只是尺寸为 0。
    const metadata = await decoder.metadata()
    if (!metadata || metadata.width <= 0 || metadata.height <= 0) {
      throw new RawImportError(RAW_UNRECOGNIZED)
    }
    if (metadata.width * metadata.height > RAW_MAX_PIXELS) {
      throw new RawImportError(`这张 RAW 超过 ${RAW_MAX_PIXELS_LABEL}，暂不支持。${RAW_CONVERT_HINT}`)
    }
    const image = await decoder.imageData()
    if (!image) {
      throw new RawImportError(undecodableReason(await decoder.metadata(true)))
    }
    if (image.bits !== 16 || !(image.data instanceof Uint16Array) || ![1, 3, 4].includes(image.colors)
      || image.width <= 0 || image.height <= 0 || image.width * image.height > RAW_MAX_PIXELS
      || image.data.length !== image.width * image.height * image.colors) {
      throw new RawImportError(`RAW 解码结果不完整，文件可能已损坏。${RAW_CONVERT_HINT}`)
    }
    const full = await decoder.metadata(true)
    if (!full?.color_data) throw new RawImportError('读不到这张 RAW 的色彩信息，无法还原颜色。')
    const transform = rawColorTransform(full.color_data, image.colors)
    const preview = await readPreview(decoder)
    // imageData 已跨线程传回独立样本，生成副本前释放 LibRaw 的 WASM 堆。
    decoder.dispose()

    const flip = full.flip ?? 0
    const iw = flip & 4 ? image.height : image.width
    const ih = flip & 4 ? image.width : image.height
    // DNG 的坐标相对 ActiveArea，与 LibRaw 输出尺寸对不上时不套用，避免校正错位
    const corrections = dng && dng.width === iw && dng.height === ih ? dng : null
    if (dng && !corrections) console.warn('DNG corrections skipped: active area mismatch', dng.width, dng.height, iw, ih)
    const crop = corrections ? corrections.crop : dng ? null : makerCrop(full, iw, ih)
    const geometry = createRawGeometry({ data: image.data, width: image.width, height: image.height, colors: image.colors, flip, filters: full.filters ?? 0, crop, corrections })
    const { width, height } = geometry

    // 浮点底图、8 位副本、分析用缩小图和噪声小块共用同一次色彩转换；逐像素复用同几个数组，不产生临时对象。
    const samples = new Float64Array(3)
    const gains = new Float64Array(3)
    const rec2020 = new Float64Array(3)
    const srgb = new Float64Array(3)
    const rgba = new Uint8ClampedArray(width * height * 4)
    const scene = createSceneCollector(width, height, PREVIEW_ANALYSIS_SIDE)
    const tiles = createTileCollector(width, height)
    const linear = packFloatLinear(width, height, (pixel) => {
      geometry.read(pixel, samples, gains)
      transform(samples, 0, gains, rec2020)
      rec2020ToSrgbInto(rec2020[0]!, rec2020[1]!, rec2020[2]!, srgb)
      mapRgbInto(srgb[0]!, srgb[1]!, srgb[2]!, srgb)
      for (let c = 0; c < 3; c++) rgba[pixel * 4 + c] = linearToSrgb8(srgb[c]!)
      rgba[pixel * 4 + 3] = 255
      scene.add(pixel, rec2020)
      tiles.add(pixel, rec2020)
      return rec2020
    })
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('无法创建 RAW 图像画布。')
    }
    ctx.putImageData(new ImageData(rgba, width, height), 0, 0)

    const sceneImage = scene.image(rec2020ToSrgb)
    const profile = buildRawProfile(sceneImage, preview, estimateNoise(tiles.images(rec2020ToSrgb)), full.color_data.dng_levels?.baseline_exposure)
    const thumbPixels = renderSdr(sceneImage, resolveLook(defaultRawDevelop(profile), profile))
    const thumbScale = Math.min(1, THUMBNAIL_SIDE / Math.max(sceneImage.width, sceneImage.height))
    const thumbCanvas = new OffscreenCanvas(Math.max(1, Math.round(sceneImage.width * thumbScale)), Math.max(1, Math.round(sceneImage.height * thumbScale)))
    const thumbCtx = thumbCanvas.getContext('2d')!
    thumbCtx.imageSmoothingQuality = 'high'
    thumbCtx.drawImage(await createImageBitmap(new ImageData(thumbPixels, sceneImage.width, sceneImage.height)), 0, 0, thumbCanvas.width, thumbCanvas.height)

    const opcodes = geometry.corrected && corrections ? [...corrections.before, ...corrections.after] : []
    const applied = [...(crop ? ['DefaultCrop'] : []), ...new Set(opcodes.map(op => OPCODE_NAMES[op.kind]))]
    if (corrections?.skipped.length) console.info('DNG opcodes not applied', corrections.skipped)
    const result: RawDecoded = {
      blob: await canvas.convertToBlob({ type: 'image/png' }),
      linear,
      thumbnail: await thumbCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }),
      profile,
      corrections: applied,
      cameraMake: metadata.camera_make,
      cameraModel: metadata.camera_model
    }
    self.postMessage({ result })
  } catch (error) {
    console.error('RAW import failed', error)
    self.postMessage({ error: describeRawFailure(error) })
  } finally {
    decoder.dispose()
  }
}
