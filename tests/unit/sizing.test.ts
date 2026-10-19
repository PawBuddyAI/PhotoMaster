import { describe, expect, it } from 'vitest'
import { customOutputSize, FIXED_SIZES, OPENAI_SIZE_LIMITS, pickFixedSize, planEditRegion } from '~/lib/inpaint/sizing'
import type { PixelRect } from '~/lib/types'

const { multiple, maxAspect, minPixels, maxPixels, maxSide } = OPENAI_SIZE_LIMITS

function expectValidCustomSize(w: number, h: number) {
  expect(w % multiple).toBe(0)
  expect(h % multiple).toBe(0)
  expect(Math.max(w / h, h / w)).toBeLessThanOrEqual(maxAspect + 1e-9)
  expect(w * h).toBeGreaterThanOrEqual(minPixels)
  expect(w * h).toBeLessThanOrEqual(maxPixels)
  expect(Math.max(w, h)).toBeLessThanOrEqual(maxSide)
}

function contains(outer: PixelRect, inner: PixelRect) {
  return outer.x <= inner.x + 1 && outer.y <= inner.y + 1
    && outer.x + outer.w >= inner.x + inner.w - 1 && outer.y + outer.h >= inner.y + inner.h - 1
}

/** 可复现的伪随机数，保证测试稳定 */
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

describe('customOutputSize', () => {
  it('各种长宽比与尺寸下都满足 OpenAI 约束', () => {
    const rand = rng(7)
    for (let i = 0; i < 2000; i++) {
      const w = 16 + rand() * 9000
      const h = 16 + rand() * 9000
      const cap = 1536 + Math.floor(rand() * 2400)
      const out = customOutputSize(w, h, cap)
      expectValidCustomSize(out.w, out.h)
    }
  })

  it('不超过成本上限，且小区域会被放大到最小像素数', () => {
    const big = customOutputSize(6000, 4000, 2048)
    expect(Math.max(big.w, big.h)).toBeLessThanOrEqual(2048)
    const small = customOutputSize(200, 200, 2048)
    expect(small.w * small.h).toBeGreaterThanOrEqual(minPixels)
  })

  it('已满足最小像素数的区域不放大，避免无谓增加成本', () => {
    const out = customOutputSize(720, 1280, 2048)
    expect(out.w).toBeLessThanOrEqual(720 + multiple)
    expect(out.h).toBeLessThanOrEqual(1280 + multiple)
  })
})

describe('pickFixedSize', () => {
  it('按长宽比选择最接近的固定尺寸', () => {
    expect(pickFixedSize(1)).toEqual([1024, 1024])
    expect(pickFixedSize(1.6)).toEqual([1536, 1024])
    expect(pickFixedSize(0.6)).toEqual([1024, 1536])
  })
})

describe('planEditRegion', () => {
  it('随机蒙版在随机图像上都得到合法、包含蒙版且几乎无形变的方案', () => {
    const rand = rng(42)
    for (let i = 0; i < 1500; i++) {
      // 原图比例限定在 3:1 以内；更极端的全景图见下方单独用例
      const imageW = Math.round(800 + rand() * 7000)
      const imageH = Math.round(imageW * (0.34 + rand() * 2.6))
      const w = Math.max(4, rand() * imageW * 0.6)
      const h = Math.max(4, rand() * imageH * 0.6)
      const mask = { x: rand() * (imageW - w), y: rand() * (imageH - h), w, h }
      const plan = planEditRegion(mask, imageW, imageH, { mode: 'custom', maxLongSide: 2048 })
      expectValidCustomSize(plan.outW, plan.outH)
      expect(plan.crop.x).toBeGreaterThanOrEqual(0)
      expect(plan.crop.y).toBeGreaterThanOrEqual(0)
      expect(plan.crop.x + plan.crop.w).toBeLessThanOrEqual(imageW)
      expect(plan.crop.y + plan.crop.h).toBeLessThanOrEqual(imageH)
      expect(contains(plan.crop, mask), JSON.stringify({ imageW, imageH, mask, plan })).toBe(true)
      // 半像素取整误差导致的比例偏差应远小于 1%
      expect(plan.distortion).toBeLessThan(0.01)
    }
  })

  it('四周留出上下文边距', () => {
    const mask = { x: 2000, y: 1500, w: 400, h: 300 }
    const plan = planEditRegion(mask, 6000, 4000, { mode: 'custom', maxLongSide: 2048 })
    expect(plan.crop.x).toBeLessThanOrEqual(mask.x - 128)
    expect(plan.crop.y).toBeLessThanOrEqual(mask.y - 128)
    expect(plan.crop.x + plan.crop.w).toBeGreaterThanOrEqual(mask.x + mask.w + 128)
    expect(plan.crop.y + plan.crop.h).toBeGreaterThanOrEqual(mask.y + mask.h + 128)
  })

  it('细长蒙版通过扩展短边满足 3:1，而不是拉伸', () => {
    const mask = { x: 500, y: 1900, w: 5000, h: 100 }
    const plan = planEditRegion(mask, 6000, 4000, { mode: 'custom', maxLongSide: 2048 })
    expect(plan.crop.w / plan.crop.h).toBeLessThanOrEqual(maxAspect + 0.01)
    expect(plan.distortion).toBeLessThan(0.01)
  })

  it('原图本身超过 3:1 且蒙版横跨全图时报告形变', () => {
    const plan = planEditRegion({ x: 0, y: 0, w: 6000, h: 1000 }, 6000, 1000, { mode: 'custom', maxLongSide: 2048 })
    expectValidCustomSize(plan.outW, plan.outH)
    expect(plan.distortion).toBeGreaterThan(0.5)
  })

  it('固定尺寸模式输出固定尺寸之一，并按其比例调整裁剪框', () => {
    const rand = rng(3)
    for (let i = 0; i < 500; i++) {
      const imageW = Math.round(1200 + rand() * 5000)
      const imageH = Math.round(1200 + rand() * 5000)
      const w = Math.max(8, rand() * imageW * 0.4)
      const h = Math.max(8, rand() * imageH * 0.4)
      const mask = { x: rand() * (imageW - w), y: rand() * (imageH - h), w, h }
      const plan = planEditRegion(mask, imageW, imageH, { mode: 'fixed', maxLongSide: 2048 })
      expect(FIXED_SIZES.some(([fw, fh]) => fw === plan.outW && fh === plan.outH)).toBe(true)
      expect(contains(plan.crop, mask), JSON.stringify({ imageW, imageH, mask, plan })).toBe(true)
    }
  })

  it('空蒙版抛出错误', () => {
    expect(() => planEditRegion({ x: 0, y: 0, w: 0, h: 10 }, 100, 100, { mode: 'custom', maxLongSide: 2048 })).toThrow()
  })
})
