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
  /** key 是这张蒙版的 maskKey，带缓存的实现直接用它查，不必再序列化一遍 */
  rasterize: (spec: MaskSpec, key: string) => Uint8Array | Float32Array = spec => rasterizeMask(spec, imageW, imageH, region, maskW, maskH)
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
    const key = maskKey(layer.mask)
    const data = rasterize(layer.mask, key)
    result.push({
      params: layer.params,
      mask: { key: `${keyPrefix}:${key}`, data, width: maskW, height: maskH, empty: isEmptyMask(data) }
    })
  }
  return result
}

/** 栅格化结果生成后不再改动；预览每帧拿到的是同一份缓存数组，是否全 0 只需扫一次 */
const emptiness = new WeakMap<Uint8Array | Float32Array, boolean>()

function isEmptyMask(data: Uint8Array | Float32Array): boolean {
  let empty = emptiness.get(data)
  if (empty === undefined) {
    empty = true
    for (let i = 0; i < data.length; i++) {
      if (data[i]! > 0) {
        empty = false
        break
      }
    }
    emptiness.set(data, empty)
  }
  return empty
}
