import { z } from 'zod'
import { sanitizeAdjustParams } from '../adjust/params'
import { constrainCrop, MAX_STRAIGHTEN_ANGLE } from '../geometry/crop'
import { createMaskSpec, rectFromCorners } from '../mask/spec'
import type { AnalysisResult, MaskSpec } from '../types'

/**
 * 读图模型的输出结构。为兼容 OpenAI strict 模式：
 * 所有字段必填、可空字段用 nullable、不用元组；数值范围写在描述里，解析后再统一限幅。
 */
const RegionSchema = z.object({
  shape: z.enum(['rect', 'ellipse', 'linear']).describe(
    'rect：矩形，适合建筑、天空、地面等规则区域；ellipse：边缘柔和的椭圆，适合人脸、主体、光斑；'
    + 'linear：线性渐变，(x0,y0) 为效果 100% 的起点，(x1,y1) 为效果衰减到 0 的终点，适合天空、地平线'
  ),
  x0: z.number().describe('rect/ellipse 为左上角 x；linear 为起点 x。0–1000 的整数，图像宽度的千分比'),
  y0: z.number().describe('rect/ellipse 为左上角 y；linear 为起点 y。0–1000 的整数，图像高度的千分比'),
  x1: z.number().describe('rect/ellipse 为右下角 x；linear 为终点 x。0–1000 的整数，图像宽度的千分比'),
  y1: z.number().describe('rect/ellipse 为右下角 y；linear 为终点 y。0–1000 的整数，图像高度的千分比')
})

const AdjustParamsSchema = z.object({
  exposure: z.number().describe('曝光，单位 EV，-5 到 5，0 不变'),
  contrast: z.number().describe('对比度，-100 到 100'),
  highlights: z.number().describe('高光，-100 到 100，负值找回亮部细节'),
  shadows: z.number().describe('阴影，-100 到 100，正值提亮暗部'),
  whites: z.number().describe('白色色阶，-100 到 100'),
  blacks: z.number().describe('黑色色阶，-100 到 100'),
  temperature: z.number().describe('色温，-100（冷）到 100（暖）'),
  tint: z.number().describe('色调，-100（偏绿）到 100（偏洋红）'),
  vibrance: z.number().describe('自然饱和度，-100 到 100'),
  saturation: z.number().describe('饱和度，-100 到 100'),
  clarity: z.number().describe('清晰度（局部对比），-100 到 100'),
  sharpen: z.number().describe('锐化，0 到 100')
})

export const AnalysisSchema = z.object({
  overall: z.string().describe('对照片的总体评价与修图思路，简体中文，2–4 句'),
  adjustments: z.array(z.object({
    title: z.string().describe('简短标题，简体中文，如“压暗过曝天空”'),
    reason: z.string().describe('为什么这样调，简体中文一句话'),
    region: RegionSchema.nullable().describe('作用区域；null 表示全图'),
    params: AdjustParamsSchema.describe('未涉及的参数填 0')
  })).describe('参数化调色建议，按重要性排序，最多 6 条'),
  generative_edits: z.array(z.object({
    title: z.string().describe('简短标题，简体中文，如“移除右侧路人”'),
    reason: z.string().describe('为什么需要修改，简体中文一句话'),
    prompt: z.string().describe('交给图像编辑模型的英文指令，描述区域内修改后应呈现的内容，例如 "Remove the person and fill with the matching brick wall"'),
    region: RegionSchema.describe('需要重绘的区域，必须完整包住目标物体并留少量余量；shape 只能是 rect 或 ellipse')
  })).describe('需要改变画面内容的局部修改（去除杂物、修复瑕疵、替换天空等），没有就返回空数组，最多 4 条'),
  crop: z.object({
    x0: z.number().describe('左上角 x，0–1000 的整数，图像宽度的千分比'),
    y0: z.number().describe('左上角 y，0–1000 的整数，图像高度的千分比'),
    x1: z.number().describe('右下角 x，0–1000 的整数，图像宽度的千分比'),
    y1: z.number().describe('右下角 y，0–1000 的整数，图像高度的千分比'),
    angle: z.number().describe('水平校正角度，单位度，-45 到 45，正值顺时针'),
    reason: z.string().describe('构图理由，简体中文')
  }).nullable().describe('构图裁剪建议，坐标为 0–1000 的千分比；构图已经很好时为 null')
})

export type AnalysisRaw = z.infer<typeof AnalysisSchema>
type RegionRaw = z.infer<typeof RegionSchema>

/** 约定的坐标满量程：0–1000 的整数千分比是 Gemini、Qwen3-VL 等读图模型训练时使用的定位格式 */
export const COORD_SCALE = 1000

/**
 * 推断整次回答的坐标单位（返回换算到 0–1 的除数）。约定为 0–1000；
 * 所有坐标都不超过 1 时说明模型输出的是 0–1 小数，按原值使用。按整次回答判断，避免逐个区域误判。
 */
export function detectCoordDivisor(raw: AnalysisRaw): number {
  const regions = [
    ...raw.adjustments.flatMap(item => item.region ? [item.region] : []),
    ...raw.generative_edits.map(item => item.region),
    ...(raw.crop ? [raw.crop] : [])
  ]
  const outOfUnit = regions.some(r => [r.x0, r.y0, r.x1, r.y1].some(v => Math.abs(v) > 1))
  return outOfUnit ? COORD_SCALE : 1
}

/** 把模型原始输出规范化为工程使用的结构：生成 id、限幅参数、区域转为 MaskSpec（坐标换算为 0–1） */
export function normalizeAnalysis(raw: AnalysisRaw, imageW: number, imageH: number, model: string): AnalysisResult {
  const divisor = detectCoordDivisor(raw)
  const crop = raw.crop
    ? (() => {
        const rect = rectFromCorners(raw.crop.x0 / divisor, raw.crop.y0 / divisor, raw.crop.x1 / divisor, raw.crop.y1 / divisor)
        const angle = Math.max(-MAX_STRAIGHTEN_ANGLE, Math.min(MAX_STRAIGHTEN_ANGLE, Number(raw.crop.angle) || 0))
        if (rect.w < 0.05 || rect.h < 0.05) {
          return null
        }
        return { id: 'crop', reason: raw.crop.reason, crop: constrainCrop({ rect, angle }, imageW, imageH) }
      })()
    : null

  return {
    overall: raw.overall,
    adjustments: raw.adjustments.map((item, index) => ({
      id: `adj-${index}`,
      title: item.title,
      reason: item.reason,
      mask: item.region ? regionToMask(item.region, divisor, false) : createMaskSpec('full'),
      params: sanitizeAdjustParams(item.params)
    })),
    generativeEdits: raw.generative_edits
      .map((item, index) => ({
        id: `gen-${index}`,
        title: item.title,
        reason: item.reason,
        prompt: item.prompt.trim(),
        mask: regionToMask(item.region, divisor, true)
      }))
      .filter(item => item.prompt.length > 0 && item.mask.rect.w > 0.005 && item.mask.rect.h > 0.005),
    crop,
    model,
    createdAt: Date.now()
  }
}

/**
 * 区域 → MaskSpec。生成式重绘不接受线性渐变（无明确边界），统一转为矩形外接框；
 * 生成式区域羽化取小一些，保证目标物体完整落在高不透明度区域内。
 */
function regionToMask(region: RegionRaw, divisor: number, generative: boolean): MaskSpec {
  const x0 = region.x0 / divisor
  const y0 = region.y0 / divisor
  const x1 = region.x1 / divisor
  const y1 = region.y1 / divisor
  if (region.shape === 'linear' && !generative) {
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
    return createMaskSpec('linear', {
      line: { x0: clamp01(x0), y0: clamp01(y0), x1: clamp01(x1), y1: clamp01(y1) }
    })
  }
  const shape = region.shape === 'ellipse' ? 'ellipse' : 'rect'
  const rect = rectFromCorners(x0, y0, x1, y1)
  return createMaskSpec(shape, generative ? { rect, feather: shape === 'ellipse' ? 0.25 : 0.15 } : { rect })
}
