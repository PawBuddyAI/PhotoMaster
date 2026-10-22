import type { LibRawSettings } from 'libraw-wasm'

export const RAW_DECODER = 'libraw-wasm@1.6.0'
/** 第一阶段：按拍摄白平衡显影为完整尺寸 8 位 sRGB，原始传感器数据另行保留。 */
export const RAW_SETTINGS = {
  halfSize: false,
  useCameraWb: true,
  useCameraMatrix: 1,
  outputColor: 1,
  outputBps: 8,
  userFlip: -1,
  userQual: 3,
  // 明确 sRGB 曲线，和现有渲染器的 sRGB → 线性解码一致。
  gamm: [1 / 2.4, 12.92]
} satisfies LibRawSettings

export const RAW_MAX_BYTES = 200 * 1024 * 1024
export const RAW_MAX_PIXELS = 60_000_000

export interface RawDecoded {
  blob: Blob
  cameraMake?: string
  cameraModel?: string
}
