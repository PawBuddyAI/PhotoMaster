import type { LibRawSettings } from 'libraw-wasm'

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
export const RAW_MAX_PIXELS = 60_000_000

export interface RawDecoded {
  /** 8 位显示 / AI 副本，不作为 RAW 调色的像素源。 */
  blob: Blob
  linear: Blob
  cameraMake?: string
  cameraModel?: string
}
