import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '~/stores/settings'

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
