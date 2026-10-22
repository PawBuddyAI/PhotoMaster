import type { ColorData } from 'libraw-wasm'
import { srgbToRec2020, type Rgb } from './hdr'

/** 输入已经由 LibRaw 扣除黑电平，maximum 必须取 imageData 之后的元数据。 */
export function rawColorTransform(color: ColorData, channels: number): (samples: ArrayLike<number>, offset: number) => Rgb {
  if (!color || !Number.isFinite(color.maximum) || color.maximum <= 0) throw new Error('RAW 缺少有效白电平。')
  if (channels === 1) return (samples, offset) => {
    const v = samples[offset]! / color.maximum
    return [v, v, v]
  }
  if (channels !== 3) throw new Error('暂不支持此 RAW 的多通道色彩模型。')
  const matrix = color.rgb_cam
  if (matrix.length !== 3 || matrix.some(row => row.length < 3 || row.slice(0, 3).some(v => !Number.isFinite(v)))
    || matrix.every(row => row.slice(0, 3).every(v => v === 0))) throw new Error('RAW 缺少相机色彩矩阵。')
  const valid = (v: number[]) => v.length >= 3 && v.slice(0, 3).every(n => Number.isFinite(n) && n > 0)
  const wb = valid(color.cam_mul) ? color.cam_mul : color.pre_mul
  if (!valid(wb)) throw new Error('RAW 缺少有效白平衡。')
  const scale = Math.min(...wb.slice(0, 3)) * color.maximum
  const gains = wb.slice(0, 3).map(v => v / scale)
  const [m00, m01, m02] = matrix[0]!
  const [m10, m11, m12] = matrix[1]!
  const [m20, m21, m22] = matrix[2]!
  return (samples, offset) => {
    const r = samples[offset]! * gains[0]!
    const g = samples[offset + 1]! * gains[1]!
    const b = samples[offset + 2]! * gains[2]!
    return srgbToRec2020(
      m00! * r + m01! * g + m02! * b,
      m10! * r + m11! * g + m12! * b,
      m20! * r + m21! * g + m22! * b
    )
  }
}
