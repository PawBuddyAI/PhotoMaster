import { isIdentityCrop } from '../geometry/crop'
import type { HighlightHeadroom } from '../image/hdr'
import type { CropSpec } from '../types'
import { COORD_SCALE } from './schema'

/** 读图分析的系统提示词：明确分工（调色走参数，内容修改走生成式）与坐标约定 */
export const ANALYSIS_SYSTEM_PROMPT = `你是一名资深摄影后期修图师。请仔细观察用户提供的照片，给出专业、克制、可执行的修图方案。

工作原则：
1. 曝光、白平衡、对比、高光阴影、色彩、清晰度等调整全部放在 adjustments 中，用参数表达，由本地软件无损执行。
   - region 为 null 表示作用于全图；只影响局部时（如天空过曝、主体偏暗、人脸偏色）请给出区域。
   - 天空、地平线这类上下渐变的区域优先用 linear；主体、人脸用 ellipse；规则区域用 rect。
   - 参数宁小勿大，追求自然真实；未涉及的参数填 0。
2. 只有需要改变画面内容时才放进 generative_edits，例如去除路人或杂物、修复污点划痕、补全缺损、替换天空。
   - 调色问题绝不能放进 generative_edits。
   - region 要完整包住目标并留少量余量；prompt 用英文描述该区域修改后应呈现的样子，并保持与周围光线、透视、颗粒一致。
3. 构图明显可改进（地平线歪斜、主体偏移、边缘有干扰）时给出 crop，否则为 null。
4. 坐标一律用 0–1000 的整数千分比：x 是到左边缘的距离占图像宽度的千分比，y 是到上边缘的距离占图像高度的千分比，左上角为 (0,0)、右下角为 (1000,1000)，与图片像素尺寸无关。
5. 所有标题、理由、总评用简体中文；generative_edits 的 prompt 用英文。`

/**
 * 读图的用户文字。headroom 只在 HDR（浮点 RAW）工程提供：附图是压到普通屏幕的预览，
 * 模型看不出参考白以上还有多少亮度，需要用文字补上。
 */
export function buildAnalysisUserText(hint: string | undefined, crop?: CropSpec | null, headroom?: HighlightHeadroom | null): string {
  const lines = ['请分析这张照片并给出修图方案。']
  if (crop && !isIdentityCrop(crop)) {
    lines.push(describeCurrentCrop(crop))
  }
  if (headroom) {
    lines.push(...describeHdr(headroom))
  }
  if (hint?.trim()) {
    lines.push(`用户的额外要求：${hint.trim()}`)
  }
  return lines.join('\n')
}

/**
 * 当前裁剪的说明。读图时发送的仍是整张图（框外已压暗），
 * 因此区域坐标继续以整张图为基准；裁剪框沿用 crop 字段的约定，模型可在此基础上给出新框。
 */
function describeCurrentCrop(crop: CropSpec): string {
  const pm = (v: number) => Math.round(v * COORD_SCALE)
  const { rect } = crop
  const angle = Number(crop.angle.toFixed(1))
  return `这张照片已经裁剪：保留区域为 x0=${pm(rect.x)}、y0=${pm(rect.y)}、x1=${pm(rect.x + rect.w)}、y1=${pm(rect.y + rect.h)}，`
    + `水平校正 ${angle}°（与 crop 字段的约定相同）。图中保留区域以外已压暗，只作参考，不会出现在最终画面里。`
    + '调色与重绘建议只针对保留区域内的画面，区域坐标仍按整张图片计算；'
    + '构图在当前裁剪的基础上判断，需要调整时 crop 给出完整的新裁剪框和角度，当前构图已经合适时为 null。'
}

/** 面积占比的写法：调用方保证不低于 0.1% */
function percent(fraction: number): string {
  const value = fraction * 100
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}%`
}

/**
 * HDR 工程的说明与实测高光余量。预览经过 SDR 肩部：参考白显示为约 sRGB 233，
 * 亮一档约 252，再往上就是纯白，所以发白不等于丢了细节。
 */
function describeHdr(headroom: HighlightHeadroom): string[] {
  const lines = [
    '这是一张相机 RAW 照片，正在以高动态范围（HDR）编辑。附图是压缩到普通屏幕的预览：比参考白（普通屏幕上的白色）更亮的高光被柔和压缩，'
    + '参考白在图中是略带灰的白，再亮一档就几乎是纯白，所以发白的区域不一定丢了细节。'
  ]
  // 第 0.1% 亮的像素不超过参考白时 peakEv 为 0，此时超过参考白的部分不到 0.1%
  if (headroom.peakEv <= 0) {
    lines.push('实测亮度（只统计最终保留的画面）：比参考白更亮的部分不到 0.1%，画面基本在普通屏幕的亮度范围内。')
    return lines
  }
  const oneStop = headroom.aboveOneStop >= 0.001 ? `其中 ${percent(headroom.aboveOneStop)} 亮一档以上` : '几乎没有亮一档以上的部分'
  const peak = headroom.peakEv >= 0.1 ? `最亮的部分比参考白高约 ${headroom.peakEv.toFixed(1)} 档` : '最亮的部分只略高于参考白'
  lines.push(
    `实测亮度（只统计最终保留的画面）：约 ${percent(headroom.aboveWhite)} 的画面比参考白更亮，${oneStop}，${peak}。`,
    '这些高光在 HDR 屏幕上会比白色更亮，在普通屏幕上被柔和压缩，不必都压到参考白以下；'
    + '需要看清其中的细节（如云层、灯光）时，再用高光、白色或曝光把它们压暗。'
  )
  return lines
}

/** 不支持 json_schema 的服务：把 JSON Schema 写进提示词，要求只输出 JSON */
export function buildJsonInstruction(schemaJson: string): string {
  return `请只输出一个 JSON 对象，不要输出 Markdown 代码块或任何解释文字。JSON 必须严格符合以下 JSON Schema：\n${schemaJson}`
}

/** 生成式编辑的指令模板：强调只改蒙版区域并与周围保持一致 */
export function buildEditPrompt(instruction: string): string {
  const text = instruction.trim().replace(/[.。]+$/, '')
  return `${text}. Only change the masked area; keep lighting, perspective, color grading, sharpness and film grain identical to the surrounding photo. Photorealistic, seamless result.`
}
