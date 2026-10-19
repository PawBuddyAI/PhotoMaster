import { binarize, dilateBinary } from '../mask/ops'

/**
 * 编辑区外扩与环带宽度，按当前分辨率长边的比例计算，
 * 这样 OpenAI 编辑尺寸与原图裁剪尺寸下得到的区域在几何上一致。
 */
export function inpaintMargins(w: number, h: number): { editMargin: number, ringWidth: number } {
  const longSide = Math.max(w, h)
  return {
    editMargin: Math.max(4, Math.round(longSide * 0.01)),
    ringWidth: Math.max(8, Math.round(longSide * 0.03))
  }
}

/** 编辑区 = 羽化蒙版非零区域再外扩一点，让模型在整个羽化过渡带内都生成新内容 */
export function buildEditRegion(mask: Uint8Array, w: number, h: number): Uint8Array {
  const { editMargin } = inpaintMargins(w, h)
  return dilateBinary(binarize(mask, 0), w, h, editMargin)
}
