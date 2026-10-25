import LibRaw from 'libraw-wasm'
import { RAW_MAX_PIXELS, RAW_MAX_PIXELS_LABEL, RAW_SETTINGS, type RawDecoded } from '../lib/image/raw-settings'
import { linearToSrgb, packFloatLinear } from '../lib/image/high-depth'
import { mapRgb, rec2020ToSrgb } from '../lib/image/hdr'
import { rawColorTransform } from '../lib/image/raw-color'
import { describeRawFailure, RAW_CONVERT_HINT, RAW_UNRECOGNIZED, RawImportError, undecodableReason } from '../lib/image/raw-errors'

// LibRaw 自身的 Worker 解码；本 Worker 负责像素转换和 PNG 编码，避免阻塞界面。
self.onmessage = async ({ data: file }: MessageEvent<File>) => {
  const decoder = new LibRaw()
  try {
    await decoder.open(new Uint8Array(await file.arrayBuffer()), RAW_SETTINGS)
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
    // imageData 已跨线程传回独立样本，生成副本前释放 LibRaw 的 WASM 堆。
    decoder.dispose()
    // 浮点底图与 8 位显示副本共用同一次色彩转换。
    const rgba = new Uint8ClampedArray(image.width * image.height * 4)
    const linear = packFloatLinear(image.width, image.height, (pixel) => {
      const rec2020 = transform(image.data, pixel * image.colors)
      const sdr = mapRgb(rec2020ToSrgb(...rec2020))
      for (let c = 0; c < 3; c++) rgba[pixel * 4 + c] = Math.round(linearToSrgb(sdr[c]!) * 255)
      rgba[pixel * 4 + 3] = 255
      return rec2020
    })
    const canvas = new OffscreenCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('无法创建 RAW 图像画布。')
    }
    ctx.putImageData(new ImageData(rgba, image.width, image.height), 0, 0)
    const result: RawDecoded = {
      blob: await canvas.convertToBlob({ type: 'image/png' }),
      linear,
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
