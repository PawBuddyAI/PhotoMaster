import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { MIN_CUSTOM_LONG_SIDE } from '~/lib/inpaint/sizing'
import type { ReasoningEffortSetting, StructuredOutputMode } from '~/lib/llm/analyze'
import { type ConnectionConfig, DEFAULT_BASE_URL } from '~/lib/llm/client'
import type { ImageQuality } from '~/lib/llm/imageEdit'
import { type OfficialModels, type PawBuddyConnection, pickModel } from '~/lib/pawbuddy'

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

/** 已连接的 PawBuddy 账户；网关地址与 Key 写在读图的连接配置里 */
export interface PawBuddyAccount {
  email: string
  user: number
  /** PawBuddy 网站，充值页与官方模型表在这里 */
  site: string
}

export interface AppSettings {
  vision: VisionSettings
  image: ImageSettings
  pawbuddy: PawBuddyAccount | null
}

const STORAGE_KEY = 'apm-settings'
/** 首次配置向导走完或跳过的标记；不属于 AppSettings，「恢复默认设置」不会让向导重新弹出 */
const SETUP_KEY = 'apm-setup'

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

function loadSetupDone(): boolean {
  try {
    return globalThis.localStorage?.getItem(SETUP_KEY) === 'done'
  } catch {
    return false
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

  /** 首次配置向导是否已走完或跳过；为 false 时外壳在启动时弹出向导 */
  const setupDone = ref(loadSetupDone())

  function completeSetup(): void {
    setupDone.value = true
    try {
      globalThis.localStorage?.setItem(SETUP_KEY, 'done')
    } catch {
      // 与设置一样，不可写时只在本次会话内记住
    }
  }

  // 有向导之前就已配好读图接口的用户不再打扰；记下标记，以后清空 Key 也不会再弹
  if (!setupDone.value && isVisionReady.value) {
    completeSetup()
  }

  function reset(): void {
    const defaults = defaultSettings()
    vision.value = defaults.vision
    image.value = defaults.image
    pawbuddy.value = defaults.pawbuddy
  }

  /** 用 PawBuddy 账户连接：读图走账户网关（允许浏览器跨域，不需要代理），修图沿用读图的连接 */
  function connectPawBuddy(conn: PawBuddyConnection): void {
    vision.value.baseURL = conn.gateway
    vision.value.apiKey = conn.key
    vision.value.useProxy = false
    image.value.sameAsVision = true
    pawbuddy.value = { email: conn.email, user: conn.user, site: conn.site }
  }

  /** 模型名换成账户能用的官方模型：当前模型在列表里就保留；修图单独配了接口时不动修图模型 */
  function applyOfficialModels(models: OfficialModels): void {
    vision.value.model = pickModel(vision.value.model, models.vision)
    if (image.value.sameAsVision) {
      image.value.model = pickModel(image.value.model, models.image)
    }
  }

  /** 断开 PawBuddy 账户：清掉网关与 Key，模型名回到默认（官方模型名在其他服务上通常不存在） */
  function disconnectPawBuddy(): void {
    const defaults = defaultSettings()
    vision.value.baseURL = defaults.vision.baseURL
    vision.value.apiKey = defaults.vision.apiKey
    vision.value.model = defaults.vision.model
    if (image.value.sameAsVision) {
      image.value.model = defaults.image.model
    }
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
    setupDone,
    completeSetup,
    reset,
    connectPawBuddy,
    applyOfficialModels,
    disconnectPawBuddy
  }
})
