import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CompletionUsage } from 'openai/resources/completions'
import type { AnyCanvas } from '~/lib/image/canvas'
import { encodeVisionImage } from '~/lib/image/vision'
import { analyzeImage, type AnalyzeOutcome, VISION_MAX_SIDE } from '~/lib/llm/analyze'
import { createOpenAIClient } from '~/lib/llm/client'
import { useEditorStore } from './editor'
import { useSettingsStore } from './settings'

/** 读图分析任务状态；失败时抛出异常，由界面负责提示 */
export const useAnalysisStore = defineStore('analysis', () => {
  const running = ref(false)
  const lastUsage = ref<CompletionUsage | null>(null)
  /** 服务不支持当前结构化输出方式、自动降级时记录新方式，供界面提示 */
  const downgradedTo = ref<string | null>(null)
  let controller: AbortController | null = null

  /**
   * 分析当前效果（source 为预览渲染结果，包含已应用的调整与重绘），
   * 这样新的建议是在现有修改基础上的增量。预览结果不含裁剪，
   * 当前裁剪通过压暗框外区域和提示词告诉模型。
   */
  async function analyze(source: AnyCanvas, hint?: string): Promise<AnalyzeOutcome> {
    if (running.value) {
      throw new Error('正在分析中，请稍候')
    }
    const settings = useSettingsStore()
    const editor = useEditorStore()
    const meta = editor.project
    if (!meta) {
      throw new Error('工程尚未打开')
    }
    controller = new AbortController()
    running.value = true
    downgradedTo.value = null
    try {
      const client = createOpenAIClient(settings.visionConnection)
      const crop = editor.doc.crop
      const imageDataUrl = await encodeVisionImage(source, crop, meta.width, meta.height, VISION_MAX_SIDE)
      const outcome = await analyzeImage(client, {
        model: settings.vision.model,
        imageDataUrl,
        imageW: meta.width,
        imageH: meta.height,
        crop,
        mode: settings.vision.structuredOutput,
        detail: settings.vision.detail,
        reasoningEffort: settings.vision.reasoningEffort,
        hint,
        signal: controller.signal
      })
      if (outcome.modeUsed !== settings.vision.structuredOutput) {
        settings.vision.structuredOutput = outcome.modeUsed
        downgradedTo.value = outcome.modeUsed
      }
      editor.setAnalysis(outcome.result)
      lastUsage.value = outcome.usage ?? null
      return outcome
    } finally {
      running.value = false
      controller = null
    }
  }

  function cancel(): void {
    controller?.abort()
  }

  return { running, lastUsage, downgradedTo, analyze, cancel }
})
