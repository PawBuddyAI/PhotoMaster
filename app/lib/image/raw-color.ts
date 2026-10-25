import type { ColorData } from 'libraw-wasm'
import { srgbToRec2020, srgbToRec2020Into, type Rgb } from './hdr'
import { RawImportError } from './raw-errors'

/**
 * 通道原始值达到白电平的这一比例开始按饱和处理，到 HIGHLIGHT_FULL 完全补齐。
 * 低于起点的像素完全不变；终点留出余量，容忍白电平元数据略高于传感器实际饱和值。
 */
const HIGHLIGHT_START = 0.9
const HIGHLIGHT_FULL = 0.98

/** 0 → 1 的平滑过渡，饱和区边缘不出现色阶断层。 */
function clipWeight(level: number): number {
  const t = Math.min(1, Math.max(0, (level - HIGHLIGHT_START) / (HIGHLIGHT_FULL - HIGHLIGHT_START)))
  return t * t * (3 - 2 * t)
}

/**
 * 输入已经由 LibRaw 扣除黑电平，maximum 必须取 imageData 之后的元数据。
 * 饱和的通道只知道「至少这么亮」：白平衡后 R / B 乘上增益会高于被截住的 G，过曝处偏粉紫。
 * 这里按中性假设把饱和通道补到同一像素最亮的通道——全饱和像素成为中性白且不低于最亮通道，
 * 只有主导通道饱和的彩色高光保持原色，未饱和的超白分量照常保留。
 * gains 是 DNG 暗角 / 色彩阴影校正的逐通道增益：饱和判断仍按增益前的原始值（饱和是传感器的属性）。
 * 传入 out 时结果写进 out 并返回它（逐像素大循环复用同一个数组，不产生临时对象）。
 */
export function rawColorTransform(color: ColorData, channels: number): (samples: ArrayLike<number>, offset: number, gains?: ArrayLike<number>, out?: Float64Array) => Rgb {
  if (!color || !Number.isFinite(color.maximum) || color.maximum <= 0) {
    throw new RawImportError('这张 RAW 缺少白电平信息，无法还原亮度。')
  }
  const white = color.maximum
  if (channels === 1) return (samples, offset, gains, out) => {
    const v = samples[offset]! / white * (gains ? gains[0]! : 1)
    if (!out) return [v, v, v]
    out.fill(v)
    return out as unknown as Rgb
  }
  if (channels !== 3) throw new RawImportError('这台相机使用四色传感器，暂不支持。')
  const matrix = color.rgb_cam
  if (matrix.length !== 3 || matrix.some(row => row.length < 3 || row.slice(0, 3).some(v => !Number.isFinite(v)))
    || matrix.every(row => row.slice(0, 3).every(v => v === 0))) {
    throw new RawImportError('这张 RAW 缺少相机的色彩信息，无法还原颜色。')
  }
  const valid = (v: number[]) => v.length >= 3 && v.slice(0, 3).every(n => Number.isFinite(n) && n > 0)
  const wb = valid(color.cam_mul) ? color.cam_mul : color.pre_mul
  if (!valid(wb)) throw new RawImportError('这张 RAW 缺少白平衡信息，无法还原颜色。')
  const scale = Math.min(...wb.slice(0, 3)) * white
  const [g0, g1, g2] = wb.slice(0, 3).map(v => v / scale)
  const [m00, m01, m02] = matrix[0]!
  const [m10, m11, m12] = matrix[1]!
  const [m20, m21, m22] = matrix[2]!
  return (samples, offset, gains, out) => {
    const sr = samples[offset]!
    const sg = samples[offset + 1]!
    const sb = samples[offset + 2]!
    let r = sr * g0! * (gains ? gains[0]! : 1)
    let g = sg * g1! * (gains ? gains[1]! : 1)
    let b = sb * g2! * (gains ? gains[2]! : 1)
    const peak = Math.max(r, g, b)
    r += clipWeight(sr / white) * (peak - r)
    g += clipWeight(sg / white) * (peak - g)
    b += clipWeight(sb / white) * (peak - b)
    const lr = m00! * r + m01! * g + m02! * b
    const lg = m10! * r + m11! * g + m12! * b
    const lb = m20! * r + m21! * g + m22! * b
    if (!out) return srgbToRec2020(lr, lg, lb)
    srgbToRec2020Into(lr, lg, lb, out)
    return out as unknown as Rgb
  }
}
