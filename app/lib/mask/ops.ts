import type { PixelRect } from '../types'

/** 阈值化为 0/1 二值图（mask > threshold 记为 1） */
export function binarize(mask: Uint8Array, threshold = 0): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) {
    out[i] = mask[i]! > threshold ? 1 : 0
  }
  return out
}

/**
 * 二值膨胀（方形结构元，半径 radius 像素）。
 * 行、列分别用前缀和判断窗口内是否存在前景，整体复杂度 O(w·h)，与半径无关。
 */
export function dilateBinary(bin: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) {
    return bin.slice()
  }
  const horizontal = new Uint8Array(bin.length)
  const prefix = new Int32Array(Math.max(w, h) + 1)

  for (let y = 0; y < h; y++) {
    const row = y * w
    prefix[0] = 0
    for (let x = 0; x < w; x++) {
      prefix[x + 1] = prefix[x]! + bin[row + x]!
    }
    for (let x = 0; x < w; x++) {
      const lo = Math.max(0, x - r)
      const hi = Math.min(w, x + r + 1)
      horizontal[row + x] = prefix[hi]! - prefix[lo]! > 0 ? 1 : 0
    }
  }

  const out = new Uint8Array(bin.length)
  for (let x = 0; x < w; x++) {
    prefix[0] = 0
    for (let y = 0; y < h; y++) {
      prefix[y + 1] = prefix[y]! + horizontal[y * w + x]!
    }
    for (let y = 0; y < h; y++) {
      const lo = Math.max(0, y - r)
      const hi = Math.min(h, y + r + 1)
      out[y * w + x] = prefix[hi]! - prefix[lo]! > 0 ? 1 : 0
    }
  }
  return out
}

/** mask > threshold 的像素外接框；没有前景时返回 null */
export function maskBoundingBox(mask: Uint8Array, w: number, h: number, threshold = 0): PixelRect | null {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (mask[row + x]! > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) {
    return null
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}
