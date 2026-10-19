import * as Comlink from 'comlink'
import { renderExport } from '../lib/image/export'
import { finalizeCandidate } from '../lib/inpaint/finalize'

/** 图像计算 Worker：全分辨率导出与重绘候选处理，避免阻塞界面 */
const api = {
  renderExport,
  finalizeCandidate
}

export type ImageWorkerApi = typeof api

Comlink.expose(api)
