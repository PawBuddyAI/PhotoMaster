/**
 * 回贴相关的像素运算。补丁 = 生成图颜色 + 羽化蒙版作为 alpha，
 * 以 source-over 叠到底图上时，alpha 为 0 的像素保持原图逐位不变。
 */

/** 构造补丁 RGBA：颜色取生成图，alpha 取蒙版 */
export function buildPatch(generated: Uint8ClampedArray, mask: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(generated.length)
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4
    out[p] = generated[p]!
    out[p + 1] = generated[p + 1]!
    out[p + 2] = generated[p + 2]!
    out[p + 3] = mask[i]!
  }
  return out
}

/** 按 source-over 把补丁叠到不透明底图上（无 canvas 环境与测试使用；浏览器内由 drawImage 完成同样的运算） */
export function compositeOver(base: Uint8ClampedArray, patch: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(base.length)
  for (let p = 0; p < base.length; p += 4) {
    const a = patch[p + 3]!
    if (a === 0) {
      out[p] = base[p]!
      out[p + 1] = base[p + 1]!
      out[p + 2] = base[p + 2]!
    } else if (a === 255) {
      out[p] = patch[p]!
      out[p + 1] = patch[p + 1]!
      out[p + 2] = patch[p + 2]!
    } else {
      const t = a / 255
      out[p] = Math.round(base[p]! * (1 - t) + patch[p]! * t)
      out[p + 1] = Math.round(base[p + 1]! * (1 - t) + patch[p + 1]! * t)
      out[p + 2] = Math.round(base[p + 2]! * (1 - t) + patch[p + 2]! * t)
    }
    out[p + 3] = 255
  }
  return out
}

/**
 * OpenAI 编辑蒙版：完全透明（alpha = 0）的像素表示允许编辑。
 * @param editRegion 编辑区二值图（1 = 允许编辑）
 */
export function toOpenAIMask(editRegion: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(editRegion.length * 4)
  for (let i = 0; i < editRegion.length; i++) {
    out[i * 4 + 3] = editRegion[i] ? 0 : 255
  }
  return out
}
