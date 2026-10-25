import * as Comlink from 'comlink'
import { renderExport } from '../lib/image/export'
import { finalizeCandidate } from '../lib/inpaint/finalize'
import { linearSize, readLinearRegion } from '../lib/image/high-depth'
import { fitSize } from '../lib/image/canvas'
import { readNoiseTiles } from '../lib/image/raw-develop'
import { estimateNoise } from '../lib/image/raw-noise'

/** 图像计算 Worker：全分辨率导出与重绘候选处理，避免阻塞界面 */
const api = {
  async linearPreview(blob: Blob, longSide: number) {
    const { width, height } = await linearSize(blob)
    const { w, h } = fitSize(width, height, longSide)
    const image = await readLinearRegion(blob, { x: 0, y: 0, w: width, h: height }, w, h)
    return Comlink.transfer(image, [image.data.buffer])
  },
  /** 旧 RAW 工程补算噪声：从主数据读出与导入时位置相同的全分辨率小块 */
  async rawNoise(blob: Blob) {
    return estimateNoise(await readNoiseTiles(blob))
  },
  renderExport,
  finalizeCandidate
}

export type ImageWorkerApi = typeof api

Comlink.expose(api)
