import { describe, expect, it } from 'vitest'
import { binarize, dilateBinary, maskBoundingBox } from '~/lib/mask/ops'
import { rasterizeMask } from '~/lib/mask/rasterize'
import { createMaskSpec, isFullMask, maskBoundsPx } from '~/lib/mask/spec'

const W = 200
const H = 100
const FULL = { x: 0, y: 0, w: W, h: H }

const at = (data: Uint8Array, x: number, y: number, w = W) => data[y * w + x]!

describe('rasterizeMask 形状', () => {
  it('full 与 none', () => {
    expect(rasterizeMask(createMaskSpec('full'), W, H, FULL, W, H).every(v => v === 255)).toBe(true)
    expect(rasterizeMask(createMaskSpec('none'), W, H, FULL, W, H).every(v => v === 0)).toBe(true)
  })

  it('硬边矩形内外分明', () => {
    const spec = createMaskSpec('rect', { rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, feather: 0 })
    const data = rasterizeMask(spec, W, H, FULL, W, H)
    expect(at(data, 100, 50)).toBe(255)
    expect(at(data, 10, 10)).toBe(0)
    expect(at(data, 190, 90)).toBe(0)
  })

  it('羽化矩形从边缘向内渐变', () => {
    const spec = createMaskSpec('rect', { rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, feather: 0.5 })
    const data = rasterizeMask(spec, W, H, FULL, W, H)
    expect(at(data, 100, 50)).toBe(255)
    const edge = at(data, 100, 12)
    const inner = at(data, 100, 25)
    expect(edge).toBeLessThan(inner)
    expect(inner).toBeLessThan(255)
  })

  it('贴住图像边界的边不羽化，避免产生暗角', () => {
    const spec = createMaskSpec('rect', { rect: { x: 0, y: 0.5, w: 1, h: 0.5 }, feather: 0.5 })
    const data = rasterizeMask(spec, W, H, FULL, W, H)
    expect(at(data, 0, 99)).toBe(255)
    expect(at(data, 199, 99)).toBe(255)
    expect(at(data, 100, 52)).toBeLessThan(255)
  })

  it('椭圆中心为 1、外接框角落为 0', () => {
    const spec = createMaskSpec('ellipse', { rect: { x: 0, y: 0, w: 1, h: 1 }, feather: 0.3 })
    const data = rasterizeMask(spec, W, H, FULL, W, H)
    expect(at(data, 100, 50)).toBe(255)
    expect(at(data, 1, 1)).toBe(0)
  })

  it('线性渐变：起点一侧为 1，终点一侧为 0，中间单调', () => {
    const spec = createMaskSpec('linear', { line: { x0: 0.5, y0: 0.2, x1: 0.5, y1: 0.8 } })
    const data = rasterizeMask(spec, W, H, FULL, W, H)
    expect(at(data, 100, 5)).toBe(255)
    expect(at(data, 100, 95)).toBe(0)
    let prev = 256
    for (let y = 20; y <= 80; y += 5) {
      const v = at(data, 100, y)
      expect(v).toBeLessThanOrEqual(prev)
      prev = v
    }
  })

  it('反转只作用于形状，强度整体缩放', () => {
    const spec = createMaskSpec('rect', { rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, feather: 0, invert: true, density: 0.5 })
    const data = rasterizeMask(spec, W, H, FULL, W, H)
    expect(at(data, 100, 50)).toBe(0)
    expect(at(data, 5, 5)).toBe(128)
  })
})

describe('rasterizeMask 画笔', () => {
  it('添加笔画覆盖经过的路径', () => {
    const spec = createMaskSpec('none', {
      strokes: [{ mode: 'add', radius: 0.05, hardness: 1, points: [0.1, 0.5, 0.9, 0.5] }]
    })
    const data = rasterizeMask(spec, W, H, FULL, W, H)
    expect(at(data, 100, 50)).toBe(255)
    expect(at(data, 100, 5)).toBe(0)
  })

  it('笔画按先后顺序合成：先加后擦，再加回来', () => {
    const line = [0.2, 0.5, 0.8, 0.5]
    const erased = rasterizeMask(createMaskSpec('full', {
      strokes: [{ mode: 'erase', radius: 0.05, hardness: 1, points: line }]
    }), W, H, FULL, W, H)
    expect(at(erased, 100, 50)).toBe(0)
    const restored = rasterizeMask(createMaskSpec('full', {
      strokes: [
        { mode: 'erase', radius: 0.05, hardness: 1, points: line },
        { mode: 'add', radius: 0.05, hardness: 1, points: line }
      ]
    }), W, H, FULL, W, H)
    expect(at(restored, 100, 50)).toBe(255)
  })

  it('柔边笔刷边缘为中间值', () => {
    const spec = createMaskSpec('none', {
      strokes: [{ mode: 'add', radius: 0.1, hardness: 0, points: [0.5, 0.5] }]
    })
    const data = rasterizeMask(spec, W, H, FULL, W, H)
    const center = at(data, 100, 50)
    const mid = at(data, 110, 50)
    expect(center).toBeGreaterThan(200)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(center)
  })
})

describe('rasterizeMask 区域一致性', () => {
  it('局部区域的栅格结果与整图结果的对应像素一致', () => {
    const spec = createMaskSpec('ellipse', {
      rect: { x: 0.1, y: 0.2, w: 0.6, h: 0.5 },
      feather: 0.4,
      strokes: [{ mode: 'erase', radius: 0.03, hardness: 0.5, points: [0.3, 0.4, 0.5, 0.45] }]
    })
    const full = rasterizeMask(spec, W, H, FULL, W, H)
    const region = { x: 40, y: 20, w: 80, h: 50 }
    const part = rasterizeMask(spec, W, H, region, region.w, region.h)
    for (let y = 0; y < region.h; y++) {
      for (let x = 0; x < region.w; x++) {
        expect(Math.abs(at(part, x, y, region.w) - at(full, x + region.x, y + region.y))).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('maskBoundsPx / isFullMask', () => {
  it('矩形外接框与笔画外接框', () => {
    expect(maskBoundsPx(createMaskSpec('rect', { rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }), W, H))
      .toEqual({ x: 20, y: 20, w: 60, h: 40 })
    const strokeOnly = createMaskSpec('none', { strokes: [{ mode: 'add', radius: 0.05, hardness: 1, points: [0.5, 0.5] }] })
    const box = maskBoundsPx(strokeOnly, W, H)!
    expect(box.x).toBeCloseTo(90)
    expect(box.w).toBeCloseTo(20)
  })

  it('空区域返回 null，反转形状覆盖全图', () => {
    expect(maskBoundsPx(createMaskSpec('none'), W, H)).toBeNull()
    expect(maskBoundsPx(createMaskSpec('rect', { density: 0 }), W, H)).toBeNull()
    expect(maskBoundsPx(createMaskSpec('rect', { invert: true }), W, H)).toEqual(FULL)
  })

  it('只有满强度、无笔画的全图蒙版才可跳过栅格化', () => {
    expect(isFullMask(createMaskSpec('full'))).toBe(true)
    expect(isFullMask(createMaskSpec('full', { density: 0.5 }))).toBe(false)
    expect(isFullMask(createMaskSpec('full', { strokes: [{ mode: 'erase', radius: 0.1, hardness: 1, points: [0.5, 0.5] }] }))).toBe(false)
  })
})

describe('蒙版二值运算', () => {
  it('膨胀与外接框', () => {
    const w = 20
    const h = 10
    const bin = new Uint8Array(w * h)
    bin[5 * w + 10] = 1
    const dilated = dilateBinary(bin, w, h, 2)
    expect(maskBoundingBox(dilated, w, h)).toEqual({ x: 8, y: 3, w: 5, h: 5 })
    expect(dilateBinary(bin, w, h, 0)).toEqual(bin)
    expect(maskBoundingBox(new Uint8Array(w * h), w, h)).toBeNull()
  })

  it('阈值化', () => {
    expect(Array.from(binarize(new Uint8Array([0, 5, 10, 200]), 5))).toEqual([0, 0, 1, 1])
  })
})
