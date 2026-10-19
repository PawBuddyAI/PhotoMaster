import { describe, expect, it } from 'vitest'
import { labToSrgb, matchColorToSurroundings, srgbToLab } from '~/lib/inpaint/colorMatch'
import { buildPatch, compositeOver, toOpenAIMask } from '~/lib/inpaint/composite'
import { buildEditRegion, inpaintMargins } from '~/lib/inpaint/regions'
import { rasterizeMask } from '~/lib/mask/rasterize'
import { createMaskSpec } from '~/lib/mask/spec'

const W = 120
const H = 80

/** 带纹理的“原图”：水平渐变 + 竖条纹 */
function makeOriginal(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4
      px[p] = 60 + x
      px[p + 1] = 90 + (x % 10) * 6
      px[p + 2] = 140 - y
      px[p + 3] = 255
    }
  }
  return px
}

function shift(src: Uint8ClampedArray, dr: number, dg: number, db: number): Uint8ClampedArray {
  const out = src.slice()
  for (let p = 0; p < out.length; p += 4) {
    out[p] = src[p]! + dr
    out[p + 1] = src[p + 1]! + dg
    out[p + 2] = src[p + 2]! + db
  }
  return out
}

function centerMask() {
  return rasterizeMask(createMaskSpec('rect', { rect: { x: 0.35, y: 0.3, w: 0.3, h: 0.4 }, feather: 0.3 }), W, H, { x: 0, y: 0, w: W, h: H }, W, H)
}

describe('Lab 转换', () => {
  it('sRGB → Lab → sRGB 往返误差不超过 1', () => {
    const lab = new Float64Array(3)
    const rgb = new Float64Array(3)
    for (let r = 0; r < 256; r += 15) {
      for (let g = 0; g < 256; g += 15) {
        for (let b = 0; b < 256; b += 15) {
          srgbToLab(r, g, b, lab)
          labToSrgb(lab, rgb)
          expect(Math.abs(rgb[0]! - r)).toBeLessThanOrEqual(1)
          expect(Math.abs(rgb[1]! - g)).toBeLessThanOrEqual(1)
          expect(Math.abs(rgb[2]! - b)).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})

describe('matchColorToSurroundings', () => {
  it('生成图整体偏色时，编辑区被拉回原图的色彩统计', () => {
    const original = makeOriginal()
    const generated = shift(original, 25, -10, 15)
    const editRegion = buildEditRegion(centerMask(), W, H)
    const { ringWidth } = inpaintMargins(W, H)
    const result = matchColorToSurroundings(generated, original, editRegion, W, H, { ringWidth })
    expect(result.applied).toBe(true)
    let before = 0
    let after = 0
    let count = 0
    for (let i = 0; i < editRegion.length; i++) {
      if (!editRegion[i]) continue
      const p = i * 4
      for (let c = 0; c < 3; c++) {
        before += Math.abs(generated[p + c]! - original[p + c]!)
        after += Math.abs(result.pixels[p + c]! - original[p + c]!)
      }
      count++
    }
    expect(after / count).toBeLessThan(before / count / 4)
  })

  it('环带像素不足时不做校正', () => {
    const original = makeOriginal()
    const generated = shift(original, 30, 30, 30)
    const all = new Uint8Array(W * H).fill(1)
    const result = matchColorToSurroundings(generated, original, all, W, H, { ringWidth: 8 })
    expect(result.applied).toBe(false)
    expect(result.pixels).toEqual(generated)
  })
})

describe('补丁合成', () => {
  it('蒙版外像素逐位等于原图，蒙版内等于生成图', () => {
    const original = makeOriginal()
    const generated = shift(original, 40, 40, -40)
    const mask = centerMask()
    const composed = compositeOver(original, buildPatch(generated, mask))
    for (let i = 0; i < mask.length; i++) {
      const p = i * 4
      if (mask[i] === 0) {
        expect([composed[p], composed[p + 1], composed[p + 2]]).toEqual([original[p], original[p + 1], original[p + 2]])
      } else if (mask[i] === 255) {
        expect([composed[p], composed[p + 1], composed[p + 2]]).toEqual([generated[p], generated[p + 1], generated[p + 2]])
      }
    }
  })

  it('OpenAI 蒙版：编辑区完全透明，其余完全不透明', () => {
    const region = new Uint8Array([1, 0, 1])
    const rgba = toOpenAIMask(region)
    expect([rgba[3], rgba[7], rgba[11]]).toEqual([0, 255, 0])
  })

  it('编辑区覆盖整个羽化过渡带并略微外扩', () => {
    const mask = centerMask()
    const region = buildEditRegion(mask, W, H)
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]! > 0) expect(region[i]).toBe(1)
    }
    expect(region.reduce((a, b) => a + b, 0)).toBeGreaterThan(mask.filter(v => v > 0).length)
  })
})
