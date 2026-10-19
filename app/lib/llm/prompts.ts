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
4. 坐标一律是相对图像宽高的归一化值（0–1），原点在左上角，x 向右、y 向下。
5. 所有标题、理由、总评用简体中文；generative_edits 的 prompt 用英文。`

export function buildAnalysisUserText(hint: string | undefined): string {
  const base = '请分析这张照片并给出修图方案。'
  return hint?.trim() ? `${base}\n用户的额外要求：${hint.trim()}` : base
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
