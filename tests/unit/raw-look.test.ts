import { describe, expect, it } from 'vitest'
import { mapLuminance, mapRgb, mapRgbInto, rec2020ToSrgb, rec2020ToSrgbInto } from '~/lib/image/hdr'
import { linearToSrgb, linearToSrgb8 } from '~/lib/image/high-depth'
import {
  applyLook,
  CHROMA_POINTS,
  fitCameraLook,
  inverseShoulder,
  linearToOklab,
  LOOK_MAX_EV,
  LOOK_POINTS,
  lookChroma,
  lookGain,
  type PreviewPixels,
  type RawLook,
  renderSdr,
  standardLook
} from '~/lib/image/raw-look'

/** 施加风格后经 SDR 肩部的显示亮度（中性像素） */
function display(look: RawLook, y: number): number {
  return mapLuminance(y * 2 ** lookGain(look, y))
}

/**
 * 场景：亮度在 2^-9 到 2^0.5 之间按对数均匀分布、打散到各处（与真实照片一样，每行都有明有暗），
 * 每行一种颜色饱和度
 */
function scene(width = 192, height = 128) {
  const data = new Float32Array(width * height * 4)
  const total = width * height
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 7919 与像素总数互质，乘法取模得到一个排列
      const luminance = 2 ** (-9 + 9.5 * ((y * width + x) * 7919 % total) / total)
      const tint = (y % 4) / 10
      const rgb = [luminance * (1 + tint), luminance, luminance * (1 - tint)]
      data.set([...rgb, 1], (y * width + x) * 4)
    }
  }
  return { data, width, height }
}

/** 按已知显示曲线（与色度倍数）渲染「相机预览」：8 位 sRGB */
function previewOf(image: ReturnType<typeof scene>, curve: (y: number) => number, chroma = 1): PreviewPixels {
  const out = new Uint8ClampedArray(image.width * image.height * 4)
  for (let p = 0; p < image.width * image.height; p++) {
    const rgb = [image.data[p * 4]!, image.data[p * 4 + 1]!, image.data[p * 4 + 2]!] as const
    const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    const target = Math.min(1, curve(y))
    let scaled = rgb.map(c => c * target / y) as unknown as [number, number, number]
    if (chroma !== 1) scaled = applyLook(scaled, { gains: new Array(LOOK_POINTS).fill(0), chroma: new Array(CHROMA_POINTS).fill(chroma) }) as [number, number, number]
    for (let c = 0; c < 3; c++) out[p * 4 + c] = Math.round(linearToSrgb(Math.min(1, Math.max(0, scaled[c]!))) * 255)
    out[p * 4 + 3] = 255
  }
  return { data: out, width: image.width, height: image.height }
}

/** 一条与标准曲线不同的「相机」曲线：更亮、更硬 */
function cameraCurve(y: number): number {
  const x = (y * 1.6) ** 1.6
  const pivot = 0.4 ** 1.6
  return x * (1 + pivot) / (x + pivot)
}

describe('出口肩部的逆', () => {
  it('与 mapLuminance 互逆，拐点以下不变', () => {
    for (const v of [0, 0.1, 0.5, 0.6, 0.8, 0.95, 0.97]) {
      expect(mapLuminance(inverseShoulder(v))).toBeCloseTo(v, 9)
    }
    expect(inverseShoulder(0.3)).toBe(0.3)
  })
})

describe('标准风格', () => {
  const look = standardLook()

  it('典型测光的中灰显示为 sRGB 约 121，RAW 白电平接近白', () => {
    expect(Math.round(linearToSrgb(display(look, 0.125)) * 255)).toBeGreaterThanOrEqual(119)
    expect(Math.round(linearToSrgb(display(look, 0.125)) * 255)).toBeLessThanOrEqual(123)
    expect(display(look, 1)).toBeGreaterThan(0.96)
  })

  it('增益后的亮度单调递增，定义域外按比例延伸（HDR 高光不被压平）', () => {
    let previous = 0
    for (let ev = -16; ev <= LOOK_MAX_EV + 3; ev += 0.125) {
      const value = 2 ** ev * 2 ** lookGain(look, 2 ** ev)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
    expect(lookGain(look, 2 ** 3)).toBeCloseTo(lookGain(look, 2 ** 7), 9)
    const highlight = applyLook([4, 4, 4], look)[0] / applyLook([2, 2, 2], look)[0]
    expect(highlight).toBeCloseTo(2, 6)
  })

  it('BaselineExposure 整体提亮：+1 EV 时半亮度的物体显示得和原来一样亮', () => {
    expect(display(standardLook(1), 0.0625)).toBeCloseTo(display(look, 0.125), 6)
  })

  it('中性灰保持中性，色度倍数只改饱和度不改亮度', () => {
    const gray = applyLook([0.18, 0.18, 0.18], look)
    expect(Math.max(...gray) - Math.min(...gray)).toBeLessThan(1e-6)
    const color = [0.3, 0.15, 0.08] as const
    const plain = linearToOklab(...applyLook(color, { ...look, chroma: new Array(CHROMA_POINTS).fill(1) }))
    const boosted = linearToOklab(...applyLook(color, look))
    expect(boosted[0]).toBeCloseTo(plain[0], 6)
    expect(Math.hypot(boosted[1], boosted[2]) / Math.hypot(plain[1], plain[2])).toBeCloseTo(lookChroma(look, plain[0]), 4)
  })

  it('标准色度：中间调略提，高光回到原色度；色度曲线按亮度线性插值、两端取边缘值', () => {
    expect(lookChroma(look, 0.5)).toBeCloseTo(1.1, 9)
    expect(lookChroma(look, 1)).toBeCloseTo(1, 9)
    expect(lookChroma(look, 0.85)).toBeCloseTo(1.05, 9)
    expect(lookChroma(look, 1.4)).toBeCloseTo(1, 9)
  })

  it('renderSdr 与逐像素施加风格、肩部、sRGB 编码一致', () => {
    const image = { data: new Float32Array([0.05, 0.1, 0.2, 1, 3, 2, 1, 1]), width: 2, height: 1 }
    const out = renderSdr(image, look)
    const expected = [[0.05, 0.1, 0.2], [3, 2, 1]].flatMap(rgb => [...mapRgb(applyLook(rgb as [number, number, number], look)).map(c => Math.round(linearToSrgb(c) * 255)), 255])
    // 8 位编码查表，与逐值计算最多差 1 级
    Array.from(out).forEach((v, i) => expect(Math.abs(v - expected[i]!)).toBeLessThanOrEqual(1))
  })
})

describe('逐像素大循环的不分配版本', () => {
  it('mapRgbInto 与 mapRgb、Into 色彩矩阵与普通版本结果相同', () => {
    const out = new Float64Array(3)
    for (const rgb of [[0.2, 0.1, 0.05], [3, 2, 1], [-0.1, 0.5, 1.4]] as Array<[number, number, number]>) {
      mapRgbInto(...rgb, out)
      expect(Array.from(out)).toEqual(mapRgb(rgb))
      rec2020ToSrgbInto(...rgb, out)
      expect(Array.from(out)).toEqual(rec2020ToSrgb(...rgb))
    }
  })

  it('linearToSrgb8 查表与逐值计算最多差 1 级，两端截断', () => {
    let worst = 0
    for (let i = 0; i <= 4096; i++) {
      const v = (i / 4096) ** 2.2
      worst = Math.max(worst, Math.abs(linearToSrgb8(v) - Math.round(linearToSrgb(v) * 255)))
    }
    expect(worst).toBeLessThanOrEqual(1)
    expect([linearToSrgb8(-1), linearToSrgb8(0), linearToSrgb8(1), linearToSrgb8(5)]).toEqual([0, 0, 255, 255])
  })
})

describe('按相机预览拟合', () => {
  const image = scene()

  it('还原相机的明暗曲线（中间调误差在 2% 以内）', () => {
    const look = fitCameraLook(image, previewOf(image, cameraCurve))!
    expect(look).not.toBeNull()
    for (const y of [0.01, 0.03, 0.08, 0.15, 0.3]) {
      expect(display(look, y)).toBeCloseTo(Math.min(1, cameraCurve(y)), 1)
      expect(Math.abs(display(look, y) - cameraCurve(y)) / cameraCurve(y)).toBeLessThan(0.05)
    }
  })

  it('预览带黑边（3:2 画面放进 4:3 预览）时去掉黑边再拟合', () => {
    const preview = previewOf(image, cameraCurve)
    const bar = 16
    const boxed = new Uint8ClampedArray(preview.width * (preview.height + bar * 2) * 4)
    for (let i = 3; i < boxed.length; i += 4) boxed[i] = 255
    boxed.set(preview.data as Uint8ClampedArray, bar * preview.width * 4)
    const look = fitCameraLook(image, { data: boxed, width: preview.width, height: preview.height + bar * 2 })!
    expect(Math.abs(display(look, 0.03) - cameraCurve(0.03)) / cameraCurve(0.03)).toBeLessThan(0.05)
  })

  it('估计出预览更高的饱和度；黑白风格的预览不去掉颜色', () => {
    const vivid = fitCameraLook(image, previewOf(image, cameraCurve, 1.3))!
    for (const lightness of [0.4, 0.5, 0.6, 0.7]) {
      expect(lookChroma(vivid, lightness)).toBeGreaterThan(1.2)
      expect(lookChroma(vivid, lightness)).toBeLessThan(1.4)
    }
    // 预览与场景色度相同时，各亮度的倍数都接近 1
    const same = fitCameraLook(image, previewOf(image, cameraCurve))!
    for (const lightness of [0.4, 0.5, 0.6, 0.7]) expect(lookChroma(same, lightness)).toBeCloseTo(1, 1)
    const mono = previewOf(image, cameraCurve)
    for (let p = 0; p < mono.data.length; p += 4) {
      const v = Math.round((mono.data[p]! + mono.data[p + 1]! + mono.data[p + 2]!) / 3)
      ;(mono.data as Uint8ClampedArray).set([v, v, v], p)
    }
    expect(fitCameraLook(image, mono)!.chroma).toEqual(new Array(CHROMA_POINTS).fill(1))
  })

  it('预览太小、亮度范围太窄或明暗离谱时返回 null（改用标准风格）', () => {
    expect(fitCameraLook(image, { data: new Uint8ClampedArray(32 * 24 * 4), width: 32, height: 24 })).toBeNull()
    const flat = new Uint8ClampedArray(image.width * image.height * 4).fill(128)
    expect(fitCameraLook(image, { data: flat, width: image.width, height: image.height })).toBeNull()
    // 预览比场景亮 6 EV：不像同一张照片
    expect(fitCameraLook(image, previewOf(image, y => Math.min(0.96, y * 64)))).toBeNull()
  })
})
