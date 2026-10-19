import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { MIN_CUSTOM_LONG_SIDE } from '~/lib/inpaint/sizing'
import type { ReasoningEffortSetting, StructuredOutputMode } from '~/lib/llm/analyze'
import { type ConnectionConfig, DEFAULT_BASE_URL } from '~/lib/llm/client'
import type { ImageQuality } from '~/lib/llm/imageEdit'

export interface VisionSettings extends ConnectionConfig {
  model: string
  /** 推理模型的思考等级（reasoning_effort） */
  reasoningEffort: ReasoningEffortSetting
  structuredOutput: StructuredOutputMode
  detail: 'auto' | 'low' | 'high'
}

export interface ImageSettings extends ConnectionConfig {
  /** 修图沿用读图的连接配置（Base URL、Key、代理） */
  sameAsVision: boolean
  model: string
  quality: ImageQuality
  /** 每次生成的候选数 */
  n: number
  /** custom：任意 WIDTHxHEIGHT（gpt-image-2 及以后）；fixed：仅 1024²/1536×1024/1024×1536 */
  sizeMode: 'custom' | 'fixed'
  /** 自定义尺寸模式下编辑分辨率的长边上限 */
  maxLongSide: number
  stream: boolean
  partialImages: number
}

export interface AppSettings {
  vision: VisionSettings
  image: ImageSettings
}

const STORAGE_KEY = 'apm-settings'

export function defaultSettings(): AppSettings {
  return {
    vision: {
      baseURL: DEFAULT_BASE_URL,
      apiKey: '',
      useProxy: false,
      model: 'gpt-6.1-sol',
      reasoningEffort: 'default',
      structuredOutput: 'json_schema',
      detail: 'high'
    },
    image: {
      baseURL: DEFAULT_BASE_URL,
      apiKey: '',
      useProxy: false,
      sameAsVision: true,
      model: 'gpt-image-2.5-sunburst',
      quality: 'high',
      n: 2,
      sizeMode: 'custom',
      maxLongSide: 2048,
      stream: false,
      partialImages: 2
    }
  }
}

function loadSettings(): AppSettings {
  const defaults = defaultSettings()
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) {
      return defaults
    }
    const saved = JSON.parse(raw) as Partial<AppSettings>
    return {
      vision: { ...defaults.vision, ...saved.vision },
      image: { ...defaults.image, ...saved.image }
    }
  } catch {
    return defaults
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const initial = loadSettings()
  const vision = ref<VisionSettings>(initial.vision)
  const image = ref<ImageSettings>(initial.image)

  watch([vision, image], () => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ vision: vision.value, image: image.value }))
    } catch {
      // 隐私模式等场景下 localStorage 不可写，设置仅在本次会话内生效
    }
  }, { deep: true })

  const visionConnection = computed<ConnectionConfig>(() => ({
    baseURL: vision.value.baseURL,
    apiKey: vision.value.apiKey,
    useProxy: vision.value.useProxy
  }))

  const imageConnection = computed<ConnectionConfig>(() => image.value.sameAsVision
    ? visionConnection.value
    : { baseURL: image.value.baseURL, apiKey: image.value.apiKey, useProxy: image.value.useProxy })

  const isVisionReady = computed(() => !!vision.value.apiKey.trim() && !!vision.value.model.trim())
  const isImageReady = computed(() => !!imageConnection.value.apiKey.trim() && !!image.value.model.trim())

  /** 编辑分辨率上限的合法取值范围 */
  const maxLongSideRange = { min: MIN_CUSTOM_LONG_SIDE, max: 3840 }

  function reset(): void {
    const defaults = defaultSettings()
    vision.value = defaults.vision
    image.value = defaults.image
  }

  return { vision, image, visionConnection, imageConnection, isVisionReady, isImageReady, maxLongSideRange, reset }
})
