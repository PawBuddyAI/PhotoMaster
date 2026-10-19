import type { AdjustParams } from '../types'

export type AdjustParamKey = keyof AdjustParams

export interface AdjustParamDef {
  key: AdjustParamKey
  label: string
  group: 'light' | 'color' | 'detail'
  min: number
  max: number
  step: number
  /** 给 LLM 的语义说明 */
  hint: string
}

export const ADJUST_PARAM_DEFS: readonly AdjustParamDef[] = [
  { key: 'exposure', label: '曝光', group: 'light', min: -5, max: 5, step: 0.05, hint: '整体亮度，单位 EV，+1 表示亮一档' },
  { key: 'contrast', label: '对比度', group: 'light', min: -100, max: 100, step: 1, hint: '中间调 S 曲线强度' },
  { key: 'highlights', label: '高光', group: 'light', min: -100, max: 100, step: 1, hint: '负值压暗亮部、找回过曝细节' },
  { key: 'shadows', label: '阴影', group: 'light', min: -100, max: 100, step: 1, hint: '正值提亮暗部' },
  { key: 'whites', label: '白色色阶', group: 'light', min: -100, max: 100, step: 1, hint: '白场位置，正值让最亮处更亮' },
  { key: 'blacks', label: '黑色色阶', group: 'light', min: -100, max: 100, step: 1, hint: '黑场位置，负值让最暗处更黑' },
  { key: 'temperature', label: '色温', group: 'color', min: -100, max: 100, step: 1, hint: '正值偏暖（黄），负值偏冷（蓝）' },
  { key: 'tint', label: '色调', group: 'color', min: -100, max: 100, step: 1, hint: '正值偏洋红，负值偏绿' },
  { key: 'vibrance', label: '自然饱和度', group: 'color', min: -100, max: 100, step: 1, hint: '优先作用于低饱和颜色' },
  { key: 'saturation', label: '饱和度', group: 'color', min: -100, max: 100, step: 1, hint: '所有颜色等比例增减' },
  { key: 'clarity', label: '清晰度', group: 'detail', min: -100, max: 100, step: 1, hint: '中间调局部对比，负值柔化' },
  { key: 'sharpen', label: '锐化', group: 'detail', min: 0, max: 100, step: 1, hint: '细节锐化强度' }
]

export const ADJUST_GROUP_LABELS: Record<AdjustParamDef['group'], string> = {
  light: '光线',
  color: '颜色',
  detail: '细节'
}

export function defaultAdjustParams(): AdjustParams {
  return {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
    clarity: 0,
    sharpen: 0
  }
}

/** 把任意来源（LLM、旧数据）的参数补齐并限制到合法范围 */
export function sanitizeAdjustParams(input: Partial<Record<AdjustParamKey, unknown>>): AdjustParams {
  const params = defaultAdjustParams()
  for (const def of ADJUST_PARAM_DEFS) {
    const value = Number(input[def.key])
    if (Number.isFinite(value)) {
      params[def.key] = Math.min(def.max, Math.max(def.min, value))
    }
  }
  return params
}

export function isIdentityParams(params: AdjustParams): boolean {
  return ADJUST_PARAM_DEFS.every(def => params[def.key] === 0)
}
