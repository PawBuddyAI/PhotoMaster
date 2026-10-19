/**
 * 与运行环境无关的画布工具：优先使用 OffscreenCanvas，因此同一套代码可在主线程和 Worker 中运行。
 */
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
export type AnyContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function get2d(canvas: AnyCanvas, willReadFrequently = false): AnyContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently }) as AnyContext2D | null
  if (!ctx) {
    throw new Error('无法创建 2D 画布上下文')
  }
  return ctx
}

export async function canvasToBlob(canvas: AnyCanvas, type = 'image/png', quality?: number): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type, quality })
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片编码失败')), type, quality)
  })
}

export function readCanvasPixels(canvas: AnyCanvas): Uint8ClampedArray {
  return get2d(canvas, true).getImageData(0, 0, canvas.width, canvas.height).data
}

export function pixelsToCanvas(pixels: Uint8ClampedArray, width: number, height: number): AnyCanvas {
  const canvas = createCanvas(width, height)
  get2d(canvas).putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0)
  return canvas
}

/** 按 EXIF 方向解码图片 */
export function decodeImage(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: 'from-image' })
}

/** 长边不超过 maxLongSide 的等比尺寸（不放大，每边至少 1 像素） */
export function fitSize(width: number, height: number, maxLongSide: number): { w: number, h: number } {
  const scale = Math.min(1, maxLongSide / Math.max(width, height))
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale))
  }
}

/** 把图像缩放到长边不超过 maxLongSide（不放大） */
export function scaleToFit(source: CanvasImageSource, width: number, height: number, maxLongSide: number): AnyCanvas {
  const { w, h } = fitSize(width, height, maxLongSide)
  const canvas = createCanvas(w, h)
  const ctx = get2d(canvas)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return canvas
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return `data:${blob.type || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`
}

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinaryString(bytes))
}

export function bytesToBinaryString(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return binary
}

export function binaryStringToBytes(binary: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
