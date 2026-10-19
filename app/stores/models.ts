import { defineStore } from 'pinia'
import { ref } from 'vue'
import { type ConnectionConfig, createOpenAIClient, normalizeBaseURL } from '~/lib/llm/client'
import { describeError, type FriendlyError } from '~/lib/llm/errors'
import { listModels } from '~/lib/llm/models'

export type ModelListStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error'

export interface ModelListEntry {
  status: ModelListStatus
  /** 获取失败或刷新中时保留上一次成功的列表 */
  models: string[]
  error: FriendlyError | null
}

const IDLE: ModelListEntry = Object.freeze({ status: 'idle', models: [], error: null })

/** 同一服务地址、Key 与转发方式共用一份列表；修图沿用读图连接时两处共享 */
function connectionKey(conn: ConnectionConfig): string {
  return [normalizeBaseURL(conn.baseURL), conn.apiKey.trim(), conn.useProxy].join('\n')
}

async function request(conn: ConnectionConfig): Promise<string[] | null> {
  return listModels(createOpenAIClient(conn, { timeout: 30_000 }))
}

/** 各连接的模型列表缓存，只保存在内存中，刷新页面后重新获取 */
export const useModelListStore = defineStore('modelList', () => {
  const entries = ref<Record<string, ModelListEntry>>({})
  const pending = new Map<string, Promise<string[] | null>>()

  function entryFor(conn: ConnectionConfig): ModelListEntry {
    return entries.value[connectionKey(conn)] ?? IDLE
  }

  /**
   * 获取模型列表并缓存；已有结果时直接返回，force 时重新请求。
   * 同一连接的并发调用共用一次请求。返回 null 表示服务不提供模型列表接口，失败时抛出异常。
   */
  function load(conn: ConnectionConfig, opts: { force?: boolean } = {}): Promise<string[] | null> {
    const key = connectionKey(conn)
    const inflight = pending.get(key)
    if (inflight) {
      return inflight
    }
    const current = entries.value[key]
    if (!opts.force && current?.status === 'ready') {
      return Promise.resolve(current.models)
    }
    if (!opts.force && current?.status === 'unsupported') {
      return Promise.resolve(null)
    }
    const previous = current?.models ?? []
    entries.value[key] = { status: 'loading', models: previous, error: null }
    const task = request(conn).then(
      (models) => {
        entries.value[key] = models
          ? { status: 'ready', models, error: null }
          : { status: 'unsupported', models: [], error: null }
        return models
      },
      (err: unknown) => {
        entries.value[key] = { status: 'error', models: previous, error: describeError(err) }
        throw err
      }
    )
    pending.set(key, task)
    // 回调总在微任务中执行，即使请求立即失败（如缺少 Key）也是先登记再清理
    const settle = () => pending.delete(key)
    task.then(settle, settle)
    return task
  }

  return { entryFor, load }
})
