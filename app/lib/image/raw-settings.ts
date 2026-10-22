import type { LibRawSettings } from 'libraw-wasm'

export const RAW_DECODER = 'libraw-wasm@1.6.0'
/** 完整尺寸 16 位线性 sRGB；在编辑管线的输出端才应用 sRGB 传递曲线。 */
export const RAW_SETTINGS = {
  halfSize: false,
  useCameraWb: true,
  useCameraMatrix: 1,
  outputColor: 1,
  outputBps: 16,
  noAutoBright: true,
  userFlip: -1,
  userQual: 3,
  gamm: [1, 1]
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
