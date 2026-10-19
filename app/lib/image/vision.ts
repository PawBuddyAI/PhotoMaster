import { cropCornersInSource, isIdentityCrop } from '../geometry/crop'
import type { CropSpec } from '../types'
import { type AnyCanvas, blobToDataUrl, canvasToBlob, get2d, scaleToFit } from './canvas'

/** 裁剪框外的压暗程度，与编辑器裁剪模式的遮罩一致 */
export const CROP_DIM_ALPHA = 0.55

/** 裁剪框在 canvasW × canvasH 画布上的四个角；有水平校正时是旋转后的四边形 */
export function cropPolygon(crop: CropSpec, imageW: number, imageH: number, canvasW: number, canvasH: number): Array<[number, number]> {
  const sx = canvasW / imageW
  const sy = canvasH / imageH
  return cropCornersInSource(crop, imageW, imageH).map(([x, y]) => [x * sx, y * sy])
}

/** 压暗裁剪框以外的区域：标出最终画面的范围，同时保留周围内容作参考 */
export function dimOutsideCrop(canvas: AnyCanvas, crop: CropSpec, imageW: number, imageH: number): void {
  const ctx = get2d(canvas)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, canvas.width, canvas.height)
  cropPolygon(crop, imageW, imageH, canvas.width, canvas.height).forEach(([x, y], i) => {
    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  })
  ctx.closePath()
  ctx.fillStyle = `rgba(0, 0, 0, ${CROP_DIM_ALPHA})`
  ctx.fill('evenodd')
  ctx.restore()
}

/**
 * 读图输入：预览结果缩放到 maxSide 以内，有裁剪时压暗框外区域，编码为 JPEG data URL。
 * 预览结果不含裁剪与旋转，这里仍发送整张图，模型返回的区域坐标因此始终以整张原图为基准。
 */
export async function encodeVisionImage(source: AnyCanvas, crop: CropSpec | null, imageW: number, imageH: number, maxSide: number): Promise<string> {
  const scaled = scaleToFit(source, source.width, source.height, maxSide)
  if (crop && !isIdentityCrop(crop)) {
    dimOutsideCrop(scaled, crop, imageW, imageH)
  }
  return blobToDataUrl(await canvasToBlob(scaled, 'image/jpeg', 0.9))
}
