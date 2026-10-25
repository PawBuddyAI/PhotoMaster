import { fitCameraLook, type PreviewPixels, type RawLook, type RawLookStyle, standardLook } from './raw-look'
import { type LinearImage, linearInfo, readLinearRegion } from './high-depth'
import { defaultNoiseStrength, type NoiseProfile } from './raw-noise'

/**
 * 从 RAW 分析出的参考数据（与用户选择无关，存在工程记录的 rawSource 里）。
 * 旧工程没有这一项，打开「RAW 基础」时再从保存的原件计算。
 */
export interface RawProfile {
  /** 按相机内嵌预览拟合的风格；没有可用预览时为 null */
  camera: RawLook | null
  /** DNG BaselineExposure，没有时为 0 */
  baselineExposure: number
  noise: NoiseProfile
}

/** 工程级的 RAW 基础处理（存在工程文档里，可撤销）。旧工程没有这一项，等同 RAW_DEVELOP_OFF。 */
export interface RawDevelop {
  look: RawLookStyle
  /** 0–100 */
  noise: { luminance: number, color: number }
}

export const RAW_DEVELOP_OFF: RawDevelop = { look: 'none', noise: { luminance: 0, color: 0 } }

export function normalizeRawDevelop(value?: Partial<RawDevelop> | null): RawDevelop {
  const look = value?.look === 'camera' || value?.look === 'standard' ? value.look : 'none'
  const strength = (v: unknown) => Number.isFinite(v) ? Math.min(100, Math.max(0, Number(v))) : 0
  return { look, noise: { luminance: strength(value?.noise?.luminance), color: strength(value?.noise?.color) } }
}

/** 新导入的 RAW：有可用预览时按相机风格，否则用通用曲线；降噪按噪点水平给默认值 */
export function defaultRawDevelop(profile: RawProfile): RawDevelop {
  return { look: profile.camera ? 'camera' : 'standard', noise: defaultNoiseStrength(profile.noise) }
}

/** 当前设置对应的风格；none 或缺少相机风格时返回 null（不施加） */
export function resolveLook(develop: RawDevelop, profile: RawProfile | undefined): RawLook | null {
  if (develop.look === 'none' || !profile) return null
  if (develop.look === 'camera' && profile.camera) return profile.camera
  return standardLook(profile.baselineExposure)
}

/** LibRaw 对没有 BaselineExposure 的文件返回 -999 */
export function baselineExposureOf(value: number | undefined): number {
  return Number.isFinite(value) && Math.abs(value!) <= 10 ? value! : 0
}

/** 解码时边写主数据边收集：按面积平均缩小的整图（拟合风格、生成缩略图用），长边为 longSide */
export function createSceneCollector(width: number, height: number, longSide: number) {
  const scale = Math.min(1, longSide / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const sum = new Float64Array(w * h * 3)
  const count = new Uint32Array(w * h)
  const column = Uint32Array.from({ length: width }, (_, x) => Math.min(w - 1, Math.floor(x * w / width)))
  const row = Uint32Array.from({ length: height }, (_, y) => Math.min(h - 1, Math.floor(y * h / height)))
  return {
    add(pixel: number, rgb: ArrayLike<number>) {
      const bin = row[Math.floor(pixel / width)]! * w + column[pixel % width]!
      sum[bin * 3]! += rgb[0]!
      sum[bin * 3 + 1]! += rgb[1]!
      sum[bin * 3 + 2]! += rgb[2]!
      count[bin]!++
    },
    /** convert 把收集的颜色换到目标空间（主数据是 Rec.2020，分析用线性 sRGB） */
    image(convert: (r: number, g: number, b: number) => readonly number[]): LinearImage {
      const data = new Float32Array(w * h * 4)
      for (let i = 0; i < w * h; i++) {
        const n = Math.max(1, count[i]!)
        const rgb = convert(sum[i * 3]! / n, sum[i * 3 + 1]! / n, sum[i * 3 + 2]! / n)
        data.set([rgb[0]!, rgb[1]!, rgb[2]!, 1], i * 4)
      }
      return { data, width: w, height: h }
    }
  }
}

const TILE_SIZE = 64
const TILE_COLUMNS = 5
const TILE_ROWS = 4

/** 噪声小块的位置：最多 5 × 4 个 64 × 64 的块，均匀分布且互不重叠（画面小时减少块数） */
function tileLayout(width: number, height: number) {
  const tw = Math.min(TILE_SIZE, width)
  const th = Math.min(TILE_SIZE, height)
  const columns = Math.max(1, Math.min(TILE_COLUMNS, Math.floor(width / tw)))
  const rows = Math.max(1, Math.min(TILE_ROWS, Math.floor(height / th)))
  const origin = (i: number, n: number, total: number, t: number) => Math.min(total - t, Math.max(0, Math.floor((i + 0.5) * total / n - t / 2)))
  return {
    tw,
    th,
    xs: Array.from({ length: columns }, (_, i) => origin(i, columns, width, tw)),
    ys: Array.from({ length: rows }, (_, i) => origin(i, rows, height, th))
  }
}

/** 已保存的浮点主数据中读出噪声小块（旧工程补算用），与 createTileCollector 位置一致 */
export async function readNoiseTiles(linear: Blob): Promise<LinearImage[]> {
  const { width, height } = await linearInfo(linear)
  const { tw, th, xs, ys } = tileLayout(width, height)
  const tiles: LinearImage[] = []
  for (const y0 of ys) {
    const band = await readLinearRegion(linear, { x: 0, y: y0, w: width, h: th }, width, th)
    for (const x0 of xs) {
      const data = new Float32Array(tw * th * 4)
      for (let y = 0; y < th; y++) data.set(band.data.subarray((y * width + x0) * 4, (y * width + x0 + tw) * 4), y * tw * 4)
      tiles.push({ data, width: tw, height: th })
    }
  }
  return tiles
}

/** 解码时边写主数据边收集噪声小块（全分辨率） */
export function createTileCollector(width: number, height: number) {
  const { tw, th, xs, ys } = tileLayout(width, height)
  const columns = xs.length
  // 每列 / 每行属于哪个块（-1 为不在块内）；块互不重叠
  const tileColumn = new Int16Array(width).fill(-1)
  const tileRow = new Int16Array(height).fill(-1)
  xs.forEach((x0, i) => tileColumn.fill(i, x0, x0 + tw))
  ys.forEach((y0, i) => tileRow.fill(i, y0, y0 + th))
  const tiles = Array.from({ length: columns * ys.length }, () => new Float32Array(tw * th * 4))
  return {
    add(pixel: number, rgb: ArrayLike<number>) {
      const x = pixel % width
      const y = Math.floor(pixel / width)
      const i = tileColumn[x]!
      const j = tileRow[y]!
      if (i < 0 || j < 0) return
      const p = ((y - ys[j]!) * tw + x - xs[i]!) * 4
      const tile = tiles[j * columns + i]!
      tile[p] = rgb[0]!
      tile[p + 1] = rgb[1]!
      tile[p + 2] = rgb[2]!
      tile[p + 3] = 1
    },
    images(convert: (r: number, g: number, b: number) => readonly number[]): LinearImage[] {
      return tiles.map((tile) => {
        for (let p = 0; p < tile.length; p += 4) {
          const rgb = convert(tile[p]!, tile[p + 1]!, tile[p + 2]!)
          tile[p] = rgb[0]!
          tile[p + 1] = rgb[1]!
          tile[p + 2] = rgb[2]!
        }
        return { data: tile, width: tw, height: th }
      })
    }
  }
}

/** 汇总分析结果：scene 为缩小后的线性 sRGB，noise 由全分辨率小块估计（estimateNoise） */
export function buildRawProfile(scene: LinearImage, preview: PreviewPixels | null, noise: NoiseProfile, baselineExposure: number | undefined): RawProfile {
  return {
    camera: preview ? fitCameraLook(scene, preview) : null,
    baselineExposure: baselineExposureOf(baselineExposure),
    noise
  }
}
