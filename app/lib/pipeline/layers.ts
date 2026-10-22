import { isIdentityParams } from '../adjust/params'
import { rasterizeMask } from '../mask/rasterize'
import { isFullMask, maskKey } from '../mask/spec'
import type { AdjustParams, MaskSpec, PixelRect } from '../types'
import type { RenderLayer } from './renderer'

export interface AdjustInput {
  params: AdjustParams
  mask: MaskSpec
}

/**
 * 把调整图层转换为渲染输入：跳过恒等参数，全图蒙版不栅格化，
 * 其余蒙版按 region 栅格化到 maskW×maskH（可低于渲染尺寸，渲染时线性放大）。
 * 纹理键包含蒙版内容，渲染器据此复用或更新已上传的纹理。
 */
export function buildRenderLayers(
  layers: AdjustInput[],
  imageW: number,
  imageH: number,
  region: PixelRect,
  maskW: number,
  maskH: number,
  keyPrefix: string,
  rasterize: (spec: MaskSpec) => Uint8Array | Float32Array = spec => rasterizeMask(spec, imageW, imageH, region, maskW, maskH)
): RenderLayer[] {
  const result: RenderLayer[] = []
  for (const layer of layers) {
    if (isIdentityParams(layer.params)) {
      continue
    }
    if (isFullMask(layer.mask)) {
      result.push({ params: layer.params, mask: null })
      continue
    }
    const data = rasterize(layer.mask)
    result.push({
      params: layer.params,
      mask: { key: `${keyPrefix}:${maskKey(layer.mask)}`, data, width: maskW, height: maskH, empty: !data.some(v => v > 0) }
    })
  }
  return result
}
