import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { MIN_CUSTOM_LONG_SIDE } from '~/lib/inpaint/sizing'
import type { ReasoningEffortSetting, StructuredOutputMode } from '~/lib/llm/analyze'
import { type ConnectionConfig, DEFAULT_BASE_URL } from '~/lib/llm/client'
import type { ImageQuality } from '~/lib/llm/imageEdit'
import { PAWBUDDY_PRESET, type PawBuddyConnection } from '~/lib/pawbuddy'

export interface VisionSettings extends ConnectionConfig {
  model: string
  /** 推理模型的思考等级（reasoning_effort） */
  reasoningEffort: ReasoningEffortSetting
  structuredOutput: StructuredOutputMode
  detail: 'auto' | 'low' | 'high'
}

export interface ImageSettings extends ConnectionConfig {
  /** 修图沿用读图的连接配置（Base URL、Key） */
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

/** 已连接的 PawBuddy 账户；网关地址与 Key 写在读图的连接配置里，连着账户时模型与思考等级固定为 PAWBUDDY_PRESET */
export interface PawBuddyAccount {
  email: string
  user: number
  /** PawBuddy 网站，充值页在这里 */
  site: string
}

export interface AppSettings {
  vision: VisionSettings
  image: ImageSettings
  pawbuddy: PawBuddyAccount | null
}

const STORAGE_KEY = 'apm-settings'

export function defaultSettings(): AppSettings {
  return {
    vision: {
      baseURL: DEFAULT_BASE_URL,
      apiKey: '',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'default',
      structuredOutput: 'json_schema',
      detail: 'high'
    },
    image: {
      baseURL: DEFAULT_BASE_URL,
      apiKey: '',
      sameAsVision: true,
      model: 'gpt-image-2.5-sunburst',
      quality: 'high',
      n: 2,
      sizeMode: 'custom',
      maxLongSide: 2048,
      stream: false,
      partialImages: 2
    },
    pawbuddy: null
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
      image: { ...defaults.image, ...saved.image },
      pawbuddy: saved.pawbuddy ?? null
    }
  } catch {
    return defaults
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const initial = loadSettings()
  const vision = ref<VisionSettings>(initial.vision)
  const image = ref<ImageSettings>(initial.image)
  const pawbuddy = ref<PawBuddyAccount | null>(initial.pawbuddy)

  watch([vision, image, pawbuddy], () => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ vision: vision.value, image: image.value, pawbuddy: pawbuddy.value }))
    } catch {
      // 隐私模式等场景下 localStorage 不可写，设置仅在本次会话内生效
    }
  }, { deep: true })

  const visionConnection = computed<ConnectionConfig>(() => ({
    baseURL: vision.value.baseURL,
    apiKey: vision.value.apiKey
  }))

  const imageConnection = computed<ConnectionConfig>(() => image.value.sameAsVision
    ? visionConnection.value
    : { baseURL: image.value.baseURL, apiKey: image.value.apiKey })

  const isVisionReady = computed(() => !!vision.value.apiKey.trim() && !!vision.value.model.trim())
  const isImageReady = computed(() => !!imageConnection.value.apiKey.trim() && !!image.value.model.trim())

  /** 编辑分辨率上限的合法取值范围 */
  const maxLongSideRange = { min: MIN_CUSTOM_LONG_SIDE, max: 3840 }

  /**
   * 配置向导是否待处理：启动时读图还没配好（没有 Key 或模型）就为 true，每次启动都重新判定。
   * AI 是应用的核心功能，不配置就无法使用，所以向导不能跳过，只能配好后走完。
   * 只在启动时判定一次：向导打开期间填好 Key、或网页版授权跳回时插件先于向导连上账户，向导都不能因此自己消失；
   * 走完后记为已处理，本次运行里外壳重新挂载（如从编辑器返回）也不会再弹
   */
  const setupPending = ref(!isVisionReady.value)

  function finishSetup(): void {
    setupPending.value = false
  }

  function reset(): void {
    const defaults = defaultSettings()
    vision.value = defaults.vision
    image.value = defaults.image
    pawbuddy.value = defaults.pawbuddy
  }

  /** 连着 PawBuddy 账户时修图沿用账户的连接，模型与思考等级用账户预设 */
  function applyPawBuddyPreset(): void {
    image.value.sameAsVision = true
    vision.value.model = PAWBUDDY_PRESET.visionModel
    vision.value.reasoningEffort = PAWBUDDY_PRESET.reasoningEffort
    image.value.model = PAWBUDDY_PRESET.imageModel
  }

  // 存档里的模型可能是早先连接时按网站模型表挑的，启动时统一改回预设
  if (pawbuddy.value) {
    applyPawBuddyPreset()
  }

  /** 用 PawBuddy 账户连接：读图走账户网关（允许浏览器跨域，网页版也能直连），修图沿用读图的连接，模型与思考等级用预设 */
  function connectPawBuddy(conn: PawBuddyConnection): void {
    vision.value.baseURL = conn.gateway
    vision.value.apiKey = conn.key
    applyPawBuddyPreset()
    pawbuddy.value = { email: conn.email, user: conn.user, site: conn.site }
  }

  /** 断开 PawBuddy 账户：清掉网关与 Key，模型名与思考等级回到默认（PawBuddy 的模型名在其他服务上通常不存在） */
  function disconnectPawBuddy(): void {
    const defaults = defaultSettings()
    vision.value.baseURL = defaults.vision.baseURL
    vision.value.apiKey = defaults.vision.apiKey
    vision.value.model = defaults.vision.model
    vision.value.reasoningEffort = defaults.vision.reasoningEffort
    image.value.model = defaults.image.model
    pawbuddy.value = null
  }

  return {
    vision,
    image,
    pawbuddy,
    visionConnection,
    imageConnection,
    isVisionReady,
    isImageReady,
    maxLongSideRange,
    setupPending,
    finishSetup,
    reset,
    connectPawBuddy,
    disconnectPawBuddy
  }
})
