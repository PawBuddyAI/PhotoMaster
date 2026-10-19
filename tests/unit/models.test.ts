import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionConfig } from '~/lib/llm/client'
import { useModelListStore } from '~/stores/models'

const CONN: ConnectionConfig = { baseURL: 'https://api.mock.test/v1', apiKey: 'test-key', useProxy: false }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const modelPage = (ids: string[]) => json({ object: 'list', data: ids.map(id => ({ id, object: 'model', created: 0, owned_by: 'test' })) })

/** store 内部自行创建客户端，因此替换全局 fetch 来模拟服务 */
function stubFetch(responder: (index: number) => Response) {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input instanceof Request ? input.url : input))
    return responder(urls.length - 1)
  }))
  return urls
}

describe('useModelListStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('获取后按连接缓存，force 时重新请求', async () => {
    const urls = stubFetch(i => modelPage(i === 0 ? ['b', 'a'] : ['c']))
    const store = useModelListStore()
    expect(store.entryFor(CONN).status).toBe('idle')

    expect(await store.load(CONN)).toEqual(['a', 'b'])
    expect(store.entryFor(CONN)).toEqual({ status: 'ready', models: ['a', 'b'], error: null })
    // Base URL 末尾的斜杠与 Key 两侧空白不影响缓存命中
    expect(await store.load({ ...CONN, baseURL: `${CONN.baseURL}/`, apiKey: ' test-key ' })).toEqual(['a', 'b'])
    expect(urls).toEqual(['https://api.mock.test/v1/models'])

    expect(await store.load(CONN, { force: true })).toEqual(['c'])
    expect(urls).toHaveLength(2)
    // 不同连接各自缓存
    expect(store.entryFor({ ...CONN, useProxy: true }).status).toBe('idle')
  })

  it('同一连接的并发调用共用一次请求', async () => {
    const urls = stubFetch(() => modelPage(['a']))
    const store = useModelListStore()
    const first = store.load(CONN)
    const second = store.load(CONN, { force: true })
    expect(store.entryFor(CONN).status).toBe('loading')
    expect(await Promise.all([first, second])).toEqual([['a'], ['a']])
    expect(urls).toHaveLength(1)
  })

  it('服务不提供模型列表时记为 unsupported，不重复请求', async () => {
    const urls = stubFetch(() => json({ error: { message: 'Not Found' } }, 404))
    const store = useModelListStore()
    expect(await store.load(CONN)).toBeNull()
    expect(await store.load(CONN)).toBeNull()
    expect(store.entryFor(CONN).status).toBe('unsupported')
    expect(urls).toHaveLength(1)
  })

  it('失败时保留上一次的列表并记录中文错误，之后可以重试', async () => {
    stubFetch(i => i === 0 ? modelPage(['a']) : json({ error: { message: 'bad key', code: 'invalid_api_key' } }, 401))
    const store = useModelListStore()
    await store.load(CONN)
    await expect(store.load(CONN, { force: true })).rejects.toThrow()
    const entry = store.entryFor(CONN)
    expect(entry.status).toBe('error')
    expect(entry.models).toEqual(['a'])
    expect(entry.error?.title).toBe('API Key 无效')
  })

  it('缺少 Key 时立即失败，且不会留下卡住的请求', async () => {
    const urls = stubFetch(() => modelPage(['a']))
    const store = useModelListStore()
    const noKey = { ...CONN, apiKey: ' ' }
    await expect(store.load(noKey)).rejects.toThrow('API Key')
    expect(store.entryFor(noKey).status).toBe('error')

    const retry = store.load(noKey)
    expect(store.entryFor(noKey).status).toBe('loading')
    await expect(retry).rejects.toThrow('API Key')
    expect(urls).toHaveLength(0)
  })
})
