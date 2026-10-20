import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
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

describe('首次配置向导标记', () => {
  beforeEach(() => {
    stubStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('全新安装时未完成，completeSetup 后写入标记，下次启动不再弹出', () => {
    const data = stubStorage()
    expect(launch().setupDone).toBe(false)

    launch().completeSetup()
    expect(data.get('apm-setup')).toBe('done')
    expect(launch().setupDone).toBe(true)
  })

  it('有向导之前就已填好读图 Key 与模型的用户直接记为完成，以后清空 Key 也不再弹出', () => {
    const data = stubStorage(configured({ apiKey: 'sk-old' }))
    expect(launch().setupDone).toBe(true)
    expect(data.get('apm-setup')).toBe('done')

    data.set('apm-settings', JSON.stringify({ vision: { apiKey: '' } }))
    expect(launch().setupDone).toBe(true)
  })

  it('Key 只有空白或模型名为空时不算配置好，仍然弹出向导', () => {
    stubStorage(configured({ apiKey: '   ' }))
    expect(launch().setupDone).toBe(false)

    const data = stubStorage(configured({ apiKey: 'sk-old', model: '' }))
    expect(launch().setupDone).toBe(false)
    expect(data.has('apm-setup')).toBe(false)
  })

  it('向导打开期间填好 Key 不会自动记为完成，要等用户走完或跳过', async () => {
    const data = stubStorage()
    const settings = launch()
    settings.vision.apiKey = 'sk-new'
    await Promise.resolve()
    expect(settings.isVisionReady).toBe(true)
    expect(settings.setupDone).toBe(false)
    expect(data.has('apm-setup')).toBe(false)
  })

  it('恢复默认设置不会让向导重新弹出', () => {
    const settings = launch()
    settings.completeSetup()
    settings.reset()
    expect(settings.setupDone).toBe(true)
    expect(launch().setupDone).toBe(true)
  })

  it('localStorage 不可用时视为未完成，completeSetup 不抛错，只在本次会话内记住', () => {
    const fail = () => {
      throw new DOMException('denied', 'SecurityError')
    }
    vi.stubGlobal('localStorage', { getItem: fail, setItem: fail, removeItem: fail })
    const settings = launch()
    expect(settings.setupDone).toBe(false)
    expect(() => settings.completeSetup()).not.toThrow()
    expect(settings.setupDone).toBe(true)
  })
})

describe('PawBuddy 账户', () => {
  const conn = { gateway: 'https://pawbuddy.example.com/v1', site: 'https://pawbuddy.example.com', user: 42, email: 'me@example.com', key: 'sk-pb' }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('连接后读图走账户网关、修图沿用读图连接，账户随设置保存', async () => {
    const data = stubStorage(configured({ baseURL: 'https://own.example.com/v1', apiKey: 'sk-own', useProxy: true }))
    const settings = launch()
    settings.image.sameAsVision = false
    settings.connectPawBuddy(conn)

    expect(settings.visionConnection).toEqual({ baseURL: conn.gateway, apiKey: 'sk-pb', useProxy: false })
    expect(settings.imageConnection).toEqual(settings.visionConnection)
    expect(settings.pawbuddy).toEqual({ email: 'me@example.com', user: 42, site: conn.site })

    await nextTick()
    expect(JSON.parse(data.get('apm-settings')!).pawbuddy).toEqual(settings.pawbuddy)
    expect(launch().pawbuddy).toEqual(settings.pawbuddy)
  })

  it('官方模型：当前模型能用就保留，否则换成列表第一个；修图单独配了接口时不动修图模型', () => {
    stubStorage()
    const settings = launch()
    settings.vision.model = 'kimi-k3'
    settings.applyOfficialModels({ vision: ['qwen3.8-max', 'kimi-k3'], image: ['image-2.5-flare', 'image-2.5-sunburst'] })
    expect(settings.vision.model).toBe('kimi-k3')
    expect(settings.image.model).toBe('image-2.5-flare')

    settings.image.sameAsVision = false
    settings.image.model = 'own-image'
    settings.applyOfficialModels({ vision: [], image: ['image-2.5-flare'] })
    expect(settings.vision.model).toBe('kimi-k3')
    expect(settings.image.model).toBe('own-image')
  })

  it('断开后清掉网关、Key 与官方模型名，回到手动填写', () => {
    stubStorage()
    const settings = launch()
    settings.connectPawBuddy(conn)
    settings.applyOfficialModels({ vision: ['qwen3.8-max'], image: ['image-2.5-flare'] })
    settings.disconnectPawBuddy()

    const defaults = defaultSettings()
    expect(settings.pawbuddy).toBeNull()
    expect(settings.vision).toMatchObject({ baseURL: defaults.vision.baseURL, apiKey: '', model: defaults.vision.model })
    expect(settings.image.model).toBe(defaults.image.model)
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
