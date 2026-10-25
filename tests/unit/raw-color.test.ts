import type { ColorData } from 'libraw-wasm'
import { describe, expect, it } from 'vitest'
import { rec2020ToSrgb } from '~/lib/image/hdr'
import { rawColorTransform } from '~/lib/image/raw-color'
import { RawImportError } from '~/lib/image/raw-errors'

const DAYLIGHT = [2, 1, 1.5, 0]
const TUNGSTEN = [1.25, 1, 2.86, 0]

/** 白电平 1000、单位色彩矩阵：输出的扩展线性 sRGB 就是白平衡后的相机值，便于直接核对。 */
function color(overrides: Partial<ColorData> = {}): ColorData {
  return {
    maximum: 1000,
    cam_mul: DAYLIGHT,
    pre_mul: DAYLIGHT,
    rgb_cam: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]],
    ...overrides
  } as unknown as ColorData
}

function develop(raw: number[], c = color()): number[] {
  return [...rec2020ToSrgb(...rawColorTransform(c, raw.length)(raw, 0))]
}

/** 白平衡为 wb 时，场景亮度为 scene 的中性物体在各通道的原始值（超过白电平即被截住） */
function neutralRaw(scene: number, wb = DAYLIGHT): number[] {
  return [0, 1, 2].map(c => Math.min(1000, 1000 * scene / wb[c]! * Math.min(...wb.slice(0, 3))))
}

function expectClose(actual: number[], expected: number[]) {
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 4))
}

describe('RAW 过曝高光', () => {
  it('中性灰与未饱和的超白分量保持原值', () => {
    expectClose(develop(neutralRaw(0.18)), [0.18, 0.18, 0.18])
    // 原始值都低于白电平的 90%：R 乘上增益后超过参考白，属于真实数据，不截断
    expectClose(develop([800, 300, 100]), [1.6, 0.3, 0.15])
  })

  it('全饱和像素成为中性白，亮度不低于最亮的通道', () => {
    expectClose(develop([1000, 1000, 1000]), [2, 2, 2])
    expectClose(develop([1000, 1000, 1000], color({ cam_mul: TUNGSTEN })), [2.86, 2.86, 2.86])
  })

  it('G 先饱和时补到最亮的通道，不偏粉紫', () => {
    // 比白电平亮 1.5 倍的中性物体：G 截在 1000，R / B 未饱和或刚好饱和
    expectClose(develop(neutralRaw(1.5)), [1.5, 1.5, 1.5])
    expectClose(develop(neutralRaw(1.5, TUNGSTEN), color({ cam_mul: TUNGSTEN })), [1.5, 1.5, 1.5])
  })

  it('只有主导通道饱和的彩色高光保持原色', () => {
    expectClose(develop([1000, 200, 100]), [2, 0.2, 0.15])
  })

  it('亮度越过饱和点时平滑过渡，各通道单调、没有断层', () => {
    let previous: number[] | undefined
    for (let scene = 0.8; scene <= 1.6; scene += 0.005) {
      const rgb = develop(neutralRaw(scene))
      // 容差来自 Rec.2020 ↔ sRGB 六位小数矩阵的往返误差
      expect(Math.max(...rgb) - Math.min(...rgb)).toBeLessThan(1e-4)
      if (previous) {
        rgb.forEach((v, i) => {
          expect(v).toBeGreaterThanOrEqual(previous![i]! - 1e-9)
          expect(v - previous![i]!).toBeLessThan(0.02)
        })
      }
      previous = rgb
    }
  })

  it('单色 RAW 按白电平归一化', () => {
    expectClose(develop([500]), [0.5, 0.5, 0.5])
  })
})

describe('RAW 色彩元数据缺失时说明原因', () => {
  it.each([
    ['白电平无效', color({ maximum: 0 }), 3, '白电平'],
    ['四色传感器', color(), 4, '四色传感器'],
    ['缺少色彩矩阵', color({ rgb_cam: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }), 3, '色彩信息'],
    ['缺少白平衡', color({ cam_mul: [0, 0, 0, 0], pre_mul: [0, 0, 0, 0] }), 3, '白平衡']
  ])('%s', (_name, data, channels, reason) => {
    const run = () => rawColorTransform(data, channels)
    expect(run).toThrow(RawImportError)
    expect(run).toThrow(reason)
  })
})
