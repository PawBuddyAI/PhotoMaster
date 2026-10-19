import { describe, expect, it } from 'vitest'
import { fitSize } from '~/lib/image/canvas'
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
