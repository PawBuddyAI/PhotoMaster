import type { LibRawSettings } from 'libraw-wasm'
import type { RawProfile } from './raw-develop'

export const RAW_DECODER = 'libraw-wasm@1.6.0'
/** LibRaw 只负责黑电平和去马赛克；白平衡、色彩转换在 Float32 中完成。 */
export const RAW_SETTINGS = {
  halfSize: false,
  useCameraWb: true,
  useCameraMatrix: 1,
  outputColor: 0,
  noAutoScale: true,
  adjustMaximumThr: 0,
  outputBps: 16,
  noAutoBright: true,
  userFlip: -1,
  userQual: 3,
  // 1.6.0 的 C++ wrapper 只接受 length == 6，声明中的二元 tuple 会被静默忽略。
  // 后四项由 LibRaw gamma_curve 计算；显式传六项才能得到真正线性输出。
  gamm: [1, 1, 0, 0, 0, 0] as unknown as [number, number]
} satisfies LibRawSettings

export const RAW_MAX_BYTES = 200 * 1024 * 1024
/**
 * 覆盖 6100 万像素一档（索尼 α7R IV / V、徕卡 M11 等，LibRaw 输出可达 9600×6376）。
 * 再放宽前须验证 LibRaw WASM 堆（上限 2 GB）与 Worker 内浮点底图的内存峰值。
 */
export const RAW_MAX_PIXELS = 64_000_000
export const RAW_MAX_PIXELS_LABEL = '6400 万像素'

export interface RawDecoded {
  /** 8 位副本（线性数据经出口肩部，不带风格）：AI 重绘的底图，补丁合成回线性底图后再统一施加风格 */
  blob: Blob
  linear: Blob
  /** 图库缩略图：按导入时的默认风格渲染 */
  thumbnail: Blob
  profile: RawProfile
  /** 解码阶段已施加的校正（DefaultCrop 与 DNG opcode 名称） */
  corrections: string[]
  cameraMake?: string
  cameraModel?: string
}
