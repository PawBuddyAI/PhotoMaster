import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { PAWBUDDY_PRESET } from '~/lib/pawbuddy'
import { defaultSettings, useSettingsStore } from '~/stores/settings'

/** node 环境没有 localStorage，换成内存实现；每次 createPinia 相当于重新打开一次应用 */
function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const data = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    removeItem: (key: string) => void data.delete(key)
  })
  return data
}

function launch() {
  setActivePinia(createPinia())
  return useSettingsStore()
}

const configured = (vision: Record<string, unknown>) => ({ 'apm-settings': JSON.stringify({ vision }) })

describe('配置向导是否弹出', () => {
  beforeEach(() => {
    stubStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('全新安装时待处理，finishSetup 后本次运行不再弹出，但没配好的话下次启动再次待处理', () => {
    const settings = launch()
    expect(settings.setupPending).toBe(true)

    settings.finishSetup()
    expect(settings.setupPending).toBe(false)
    expect(launch().setupPending).toBe(true)
  })

  it('已填好读图 Key 与模型时不弹出', () => {
    stubStorage(configured({ apiKey: 'sk-old' }))
    expect(launch().setupPending).toBe(false)
  })

  it('配好后又清空 Key，下次启动再次弹出', () => {
    const data = stubStorage(configured({ apiKey: 'sk-old' }))
    expect(launch().setupPending).toBe(false)

    data.set('apm-settings', JSON.stringify({ vision: { apiKey: '' } }))
    expect(launch().setupPending).toBe(true)
  })

  it('Key 只有空白或模型名为空时不算配置好，仍然弹出向导', () => {
    stubStorage(configured({ apiKey: '   ' }))
    expect(launch().setupPending).toBe(true)

    stubStorage(configured({ apiKey: 'sk-old', model: '' }))
    expect(launch().setupPending).toBe(true)
  })

  it('向导打开期间填好 Key 不会让它自己消失，要等用户走完', async () => {
    const settings = launch()
    settings.vision.apiKey = 'sk-new'
    await Promise.resolve()
    expect(settings.isVisionReady).toBe(true)
    expect(settings.setupPending).toBe(true)
  })

  it('启动后才连上 PawBuddy 账户（网页版授权跳回）时向导仍待处理，可以停在「准备就绪」', () => {
    const settings = launch()
    settings.connectPawBuddy({ gateway: 'https://pawbuddy.example.com/v1', site: 'https://pawbuddy.example.com', user: 42, email: 'me@example.com', key: 'sk-pb' })
    expect(settings.isVisionReady).toBe(true)
    expect(settings.setupPending).toBe(true)
  })

  it('恢复默认设置不影响本次运行已处理的向导，清掉 Key 后下次启动再弹出', async () => {
    stubStorage(configured({ apiKey: 'sk-old' }))
    const settings = launch()
    settings.reset()
    await nextTick()
    expect(settings.setupPending).toBe(false)
    expect(launch().setupPending).toBe(true)
  })

  it('localStorage 不可用时按全新安装处理，finishSetup 不抛错', () => {
    const fail = () => {
      throw new DOMException('denied', 'SecurityError')
    }
    vi.stubGlobal('localStorage', { getItem: fail, setItem: fail, removeItem: fail })
    const settings = launch()
    expect(settings.setupPending).toBe(true)
    expect(() => settings.finishSetup()).not.toThrow()
    expect(settings.setupPending).toBe(false)
  })
})

describe('PawBuddy 账户', () => {
  const conn = { gateway: 'https://pawbuddy.example.com/v1', site: 'https://pawbuddy.example.com', user: 42, email: 'me@example.com', key: 'sk-pb' }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('连接后读图走账户网关、修图沿用读图连接，模型与思考等级换成账户预设，账户随设置保存', async () => {
    const data = stubStorage(configured({ baseURL: 'https://own.example.com/v1', apiKey: 'sk-own', model: 'gpt-6-luna', reasoningEffort: 'low' }))
    const settings = launch()
    settings.image.sameAsVision = false
    settings.image.model = 'own-image'
    settings.connectPawBuddy(conn)

    expect(settings.visionConnection).toEqual({ baseURL: conn.gateway, apiKey: 'sk-pb' })
    expect(settings.imageConnection).toEqual(settings.visionConnection)
    expect(settings.vision).toMatchObject({ model: 'deepseek-v4.1-flash', reasoningEffort: 'max' })
    expect(settings.image.model).toBe('image-2.5-sunburst')
    expect(settings.isImageReady).toBe(true)
    expect(settings.pawbuddy).toEqual({ email: 'me@example.com', user: 42, site: conn.site })

    await nextTick()
    const saved = JSON.parse(data.get('apm-settings')!)
    expect(saved.pawbuddy).toEqual(settings.pawbuddy)
    expect(saved.vision).toMatchObject({ model: PAWBUDDY_PRESET.visionModel, reasoningEffort: PAWBUDDY_PRESET.reasoningEffort })
    expect(saved.image).toMatchObject({ sameAsVision: true, model: PAWBUDDY_PRESET.imageModel })
    expect(launch().pawbuddy).toEqual(settings.pawbuddy)
  })

  it('连着账户时启动即改回预设：存档里是早先按模型表挑的模型、别的思考等级、或修图单独配了接口时都不算数', async () => {
    const data = stubStorage({
      'apm-settings': JSON.stringify({
        vision: { baseURL: conn.gateway, apiKey: 'sk-pb', model: 'qwen3.8-max', reasoningEffort: 'default' },
        image: { sameAsVision: false, baseURL: 'https://own.example.com/v1', apiKey: 'sk-own', model: 'image-2.5-flare' },
        pawbuddy: { email: 'me@example.com', user: 42, site: conn.site }
      })
    })
    const settings = launch()
    expect(settings.vision).toMatchObject({ model: PAWBUDDY_PRESET.visionModel, reasoningEffort: 'max' })
    expect(settings.image).toMatchObject({ sameAsVision: true, model: PAWBUDDY_PRESET.imageModel })
    expect(settings.imageConnection).toEqual(settings.visionConnection)

    await nextTick()
    expect(JSON.parse(data.get('apm-settings')!).vision).toMatchObject({ model: PAWBUDDY_PRESET.visionModel, reasoningEffort: 'max' })
  })

  it('没连账户时存档里的模型与思考等级照常保留', () => {
    stubStorage(configured({ apiKey: 'sk-own', model: 'deepseek-v4.1-flash-custom', reasoningEffort: 'low' }))
    expect(launch().vision).toMatchObject({ model: 'deepseek-v4.1-flash-custom', reasoningEffort: 'low' })
  })

  it('断开后清掉网关、Key 与 PawBuddy 的预设，回到手动填写', () => {
    stubStorage()
    const settings = launch()
    settings.connectPawBuddy(conn)
    settings.disconnectPawBuddy()

    const defaults = defaultSettings()
    expect(settings.pawbuddy).toBeNull()
    expect(settings.vision).toMatchObject({
      baseURL: defaults.vision.baseURL,
      apiKey: '',
      model: defaults.vision.model,
      reasoningEffort: defaults.vision.reasoningEffort
    })
    expect(settings.image).toMatchObject({ sameAsVision: true, model: defaults.image.model })
    expect(settings.isVisionReady).toBe(false)
  })

  it('恢复默认设置同时断开账户', () => {
    stubStorage()
    const settings = launch()
    settings.connectPawBuddy(conn)
    settings.reset()
    expect(settings.pawbuddy).toBeNull()
    expect(settings.vision.apiKey).toBe('')
  })
})
