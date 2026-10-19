import { describe, expect, it } from 'vitest'
import {
  applyAffine,
  applyCropAspect,
  constrainCrop,
  cropOutputSize,
  isCropInside,
  outputToSourceAffine,
  rotatedToSource,
  sourceBoundsOfOutputRect
} from '~/lib/geometry/crop'
import { sourceRegionForTile, tileAffine } from '~/lib/image/export'

const W = 4000
const H = 3000

describe('裁剪几何', () => {
  it('不旋转时全图裁剪框保持不变', () => {
    const crop = constrainCrop({ rect: { x: 0, y: 0, w: 1, h: 1 }, angle: 0 }, W, H)
    expect(crop.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('旋转后自动收缩到合法区域，且尽量大', () => {
    for (const angle of [-30, -5, 3, 12, 45]) {
      const crop = constrainCrop({ rect: { x: 0, y: 0, w: 1, h: 1 }, angle }, W, H)
      expect(isCropInside(crop, W, H)).toBe(true)
      expect(crop.rect.w).toBeLessThan(1)
      // 稍微放大一点就会越界，说明已经是最大合法框
      const grown = { ...crop, rect: { x: crop.rect.x - 0.01, y: crop.rect.y - 0.01, w: crop.rect.w + 0.02, h: crop.rect.h + 0.02 } }
      expect(isCropInside(grown, W, H, 0)).toBe(false)
    }
  })

  it('角度超出范围时被限制在 ±45°', () => {
    expect(constrainCrop({ rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, angle: 80 }, W, H).angle).toBe(45)
  })

  it('按长宽比生成裁剪框', () => {
    const crop = applyCropAspect({ rect: { x: 0, y: 0, w: 1, h: 1 }, angle: 0 }, 1, W, H)
    const size = cropOutputSize(crop, W, H)
    expect(Math.abs(size.w / size.h - 1)).toBeLessThan(0.01)
    expect(size.h).toBe(H)
  })

  it('输出像素到原图的仿射变换与旋转映射一致', () => {
    const crop = constrainCrop({ rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, angle: 10 }, W, H)
    const m = outputToSourceAffine(crop, W, H)
    const ox = 123
    const oy = 456
    const expected = rotatedToSource(crop.rect.x * W + ox, crop.rect.y * H + oy, crop.angle, W, H)
    const actual = applyAffine(m, ox, oy)
    expect(actual[0]).toBeCloseTo(expected[0], 6)
    expect(actual[1]).toBeCloseTo(expected[1], 6)
    expect(rotatedToSource(W / 2, H / 2, 33, W, H)).toEqual([W / 2, H / 2])
  })

  it('无裁剪时为恒等变换', () => {
    expect(outputToSourceAffine(null, W, H)).toEqual([1, 0, 0, 0, 1, 0])
    expect(cropOutputSize(null, W, H)).toEqual({ w: W, h: H })
  })
})

describe('分块导出几何', () => {
  it('块对应的原图区域包含边距并按 64 像素对齐', () => {
    const crop = constrainCrop({ rect: { x: 0, y: 0, w: 1, h: 1 }, angle: 7 }, W, H)
    const m = outputToSourceAffine(crop, W, H)
    const tile = { x: 1024, y: 512, w: 1024, h: 1024 }
    const pad = 100
    const region = sourceRegionForTile(m, tile, pad, W, H)
    const bounds = sourceBoundsOfOutputRect(m, tile)
    expect(region.x % 64 === 0 || region.x === 0).toBe(true)
    expect(region.y % 64 === 0 || region.y === 0).toBe(true)
    expect(region.x).toBeLessThanOrEqual(Math.max(0, bounds.x - pad))
    expect(region.x + region.w).toBeGreaterThanOrEqual(Math.min(W, bounds.x + bounds.w + pad) - 1)
  })

  it('块内坐标经 tileAffine 后与整图映射一致', () => {
    const crop = constrainCrop({ rect: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }, angle: -4 }, W, H)
    const m = outputToSourceAffine(crop, W, H)
    const tile = { x: 2048, y: 0, w: 1000, h: 800 }
    const region = sourceRegionForTile(m, tile, 50, W, H)
    const local = applyAffine(tileAffine(m, tile, region), 10, 20)
    const global = applyAffine(m, tile.x + 10, tile.y + 20)
    expect(local[0] + region.x).toBeCloseTo(global[0], 6)
    expect(local[1] + region.y).toBeCloseTo(global[1], 6)
  })
})
