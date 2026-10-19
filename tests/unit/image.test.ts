import { describe, expect, it } from 'vitest'
import { constrainCrop, cropCornersInSource } from '~/lib/geometry/crop'
import { fitSize } from '~/lib/image/canvas'
import { cropPolygon } from '~/lib/image/vision'
import { VISION_MAX_SIDE } from '~/lib/llm/analyze'

describe('fitSize', () => {
  it('横图、竖图按长边等比缩放', () => {
    expect(fitSize(6000, 4000, 1300)).toEqual({ w: 1300, h: 867 })
    expect(fitSize(4000, 6000, 1300)).toEqual({ w: 867, h: 1300 })
    expect(fitSize(1600, 1000, 1300)).toEqual({ w: 1300, h: 813 })
  })

  it('方图缩放到上限的正方形', () => {
    expect(fitSize(5000, 5000, 1300)).toEqual({ w: 1300, h: 1300 })
  })

  it('不超过上限时保持原尺寸，不放大', () => {
    expect(fitSize(800, 600, 1300)).toEqual({ w: 800, h: 600 })
    expect(fitSize(1300, 1300, 1300)).toEqual({ w: 1300, h: 1300 })
  })

  it('极端长宽比时短边至少 1 像素', () => {
    expect(fitSize(100_000, 10, 1300)).toEqual({ w: 1300, h: 1 })
  })

  it('读图尺寸：各种来源尺寸都落在 1300×1300 以内且比例不变', () => {
    expect(VISION_MAX_SIDE).toBe(1300)
    for (const [w, h] of [[8192, 5464], [1301, 1], [2048, 2048], [3000, 1000], [1000, 3000], [1299, 977]] as const) {
      const size = fitSize(w, h, VISION_MAX_SIDE)
      const scale = Math.min(1, VISION_MAX_SIDE / Math.max(w, h))
      expect(Math.max(size.w, size.h)).toBe(Math.min(VISION_MAX_SIDE, Math.max(w, h)))
      // 每边只有取整误差（不超过半个像素），比例因此保持不变
      expect(Math.abs(size.w - w * scale)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(size.h - h * scale)).toBeLessThanOrEqual(0.5)
    }
  })
})

describe('cropPolygon', () => {
  const W = 4000
  const H = 3000
  const { w: CW, h: CH } = fitSize(W, H, VISION_MAX_SIDE)

  it('没有水平校正时四角就是裁剪框按画布比例缩放', () => {
    const polygon = cropPolygon({ rect: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 }, angle: 0 }, W, H, CW, CH)
    const expected = [[0.1, 0.2], [0.6, 0.2], [0.6, 0.8], [0.1, 0.8]].map(([x, y]) => [x! * CW, y! * CH])
    polygon.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(expected[i]![0]!, 6)
      expect(y).toBeCloseTo(expected[i]![1]!, 6)
    })
  })

  it('有水平校正时是旋转后的四边形，与原图坐标按比例一致且落在画布内', () => {
    for (const angle of [-12, 4, 30]) {
      const crop = constrainCrop({ rect: { x: 0, y: 0, w: 1, h: 1 }, angle }, W, H)
      const polygon = cropPolygon(crop, W, H, CW, CH)
      const source = cropCornersInSource(crop, W, H)
      polygon.forEach(([x, y], i) => {
        expect(x).toBeCloseTo(source[i]![0] * CW / W, 6)
        expect(y).toBeCloseTo(source[i]![1] * CH / H, 6)
        expect(x).toBeGreaterThanOrEqual(-1e-6)
        expect(y).toBeGreaterThanOrEqual(-1e-6)
        expect(x).toBeLessThanOrEqual(CW + 1e-6)
        expect(y).toBeLessThanOrEqual(CH + 1e-6)
      })
      // 上边不再水平：画面顺时针校正时，裁剪框在原图中逆时针倾斜，右上角比左上角高
      expect(Math.sign(polygon[1]![1] - polygon[0]![1])).toBe(Math.sign(-angle))
    }
  })
})
