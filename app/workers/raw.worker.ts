import LibRaw from 'libraw-wasm'
import { RAW_MAX_PIXELS, RAW_SETTINGS, type RawDecoded } from '../lib/image/raw-settings'

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
    if (!image || image.bits !== 8 || ![1, 3, 4].includes(image.colors)
      || image.width <= 0 || image.height <= 0 || image.width * image.height > RAW_MAX_PIXELS
      || image.data.length !== image.width * image.height * image.colors) {
      throw new Error('RAW 解码结果不完整。')
    }
    const rgba = new Uint8ClampedArray(image.width * image.height * 4)
    for (let pixel = 0; pixel < image.width * image.height; pixel++) {
      const src = pixel * image.colors
      const dst = pixel * 4
      rgba[dst] = image.data[src]!
      rgba[dst + 1] = image.data[src + (image.colors === 1 ? 0 : 1)]!
      rgba[dst + 2] = image.data[src + (image.colors === 1 ? 0 : 2)]!
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
