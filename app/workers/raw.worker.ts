import LibRaw from 'libraw-wasm'
import { RAW_MAX_PIXELS, RAW_SETTINGS, type RawDecoded } from '../lib/image/raw-settings'
import { linearToSrgb, packFloatLinear } from '../lib/image/high-depth'
import { mapRgb, rec2020ToSrgb } from '../lib/image/hdr'
import { rawColorTransform } from '../lib/image/raw-color'

// LibRaw 自身的 Worker 解码；本 Worker 负责像素转换和 PNG 编码，避免阻塞界面。
self.onmessage = async ({ data: file }: MessageEvent<File>) => {
  const decoder = new LibRaw()
  try {
    await decoder.open(new Uint8Array(await file.arrayBuffer()), RAW_SETTINGS)
    const metadata = await decoder.metadata()
    if (!metadata || metadata.width <= 0 || metadata.height <= 0) {
      throw new Error('无法读取 RAW 尺寸。')
    }
    if (metadata.width * metadata.height > RAW_MAX_PIXELS) {
      self.postMessage({ error: '这张 RAW 超过 6000 万像素，请先缩小或转换为 PNG / JPEG 后导入。' })
      return
    }
    const image = await decoder.imageData()
    if (!image || image.bits !== 16 || !(image.data instanceof Uint16Array) || ![1, 3, 4].includes(image.colors)
      || image.width <= 0 || image.height <= 0 || image.width * image.height > RAW_MAX_PIXELS
      || image.data.length !== image.width * image.height * image.colors) {
      throw new Error('RAW 解码结果不完整。')
    }
    const full = await decoder.metadata(true)
    if (!full?.color_data) throw new Error('无法读取 RAW 色彩元数据。')
    const transform = rawColorTransform(full.color_data, image.colors)
    // imageData 已跨线程传回独立样本，生成副本前释放 LibRaw 的 WASM 堆。
    decoder.dispose()
    const linear = packFloatLinear(image.width, image.height, pixel => transform(image.data, pixel * image.colors))
    const rgba = new Uint8ClampedArray(image.width * image.height * 4)
    for (let pixel = 0; pixel < image.width * image.height; pixel++) {
      const src = pixel * image.colors
      const dst = pixel * 4
      const rgb = mapRgb(rec2020ToSrgb(...transform(image.data, src)))
      for (let c = 0; c < 3; c++) rgba[dst + c] = Math.round(linearToSrgb(rgb[c]!) * 255)
      rgba[dst + 3] = 255
    }
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
    self.postMessage({ error: '无法解码这张 RAW：文件可能损坏，或当前不支持此机型 / 压缩方式。请先转换为 PNG / JPEG 后导入。' })
  } finally {
    decoder.dispose()
  }
}
