import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from 'openai'
import { isDesktop } from '~/lib/desktop'

export interface FriendlyError {
  title: string
  description: string
  /** 被用户主动取消，界面通常不需要提示 */
  aborted?: boolean
  /** 网页版连不上服务，换桌面版（不受跨域限制）可能解决；界面可以顺带给出下载入口 */
  suggestDesktop?: boolean
  /** 账户余额不足，界面提供充值入口 */
  insufficientBalance?: boolean
}

/** 模型输出不符合约定格式 */
export class AnalysisFormatError extends Error {
  override name = 'AnalysisFormatError'
}

const MODERATION_CATEGORY_LABELS: Record<string, string> = {
  'harassment': '骚扰',
  'hate': '仇恨',
  'self-harm': '自我伤害',
  'sexual': '色情',
  'violence': '暴力',
  'illicit': '违法'
}

interface ModerationDetails {
  moderation_stage?: 'input' | 'output' | 'unknown'
  categories?: string[]
}

export function isAbortError(err: unknown): boolean {
  return err instanceof APIUserAbortError
    || (err instanceof DOMException && err.name === 'AbortError')
    || (err instanceof Error && err.name === 'AbortError')
}

/** 把 SDK、网络和业务异常转换为面向用户的中文说明 */
export function describeError(err: unknown): FriendlyError {
  if (isAbortError(err)) {
    return { title: '已取消', description: '请求已被取消', aborted: true }
  }
  if (err instanceof APIConnectionTimeoutError) {
    return { title: '请求超时', description: '服务长时间没有响应，可以稍后重试，或降低编辑分辨率和质量档位' }
  }
  if (err instanceof APIConnectionError) {
    // 桌面版经 Rust 端请求，不会遇到跨域拦截
    const desktop = isDesktop()
    return {
      title: '无法连接到服务',
      description: desktop
        ? '请检查 Base URL 和网络'
        : '请检查 Base URL 和网络。有些服务不允许网页直接访问（不支持跨域 CORS），这种服务请改用桌面版',
      suggestDesktop: !desktop
    }
  }
  if (err instanceof APIError) {
    if (err.code === 'moderation_blocked') {
      return describeModeration((err.error as { moderation_details?: ModerationDetails } | undefined)?.moderation_details)
    }
    const detail = err.message || '未知错误'
    if (
      [402, 403, 429].includes(err.status ?? 0)
      && (/^insufficient_(?:account_)?balance$/i.test(err.code ?? '')
        || /insufficient (?:account )?balance|(?:account )?balance (?:is )?insufficient|余额不足/i.test(detail))
    ) {
      return {
        title: '账户余额不足',
        description: 'AI 服务账户余额不足，请充值后重试。',
        insufficientBalance: true
      }
    }
    switch (err.status) {
      case 401:
        return { title: 'API Key 无效', description: '请在设置中检查 API Key 是否正确' }
      case 403:
        return { title: '没有访问权限', description: detail }
      case 404:
        return { title: '接口或模型不存在', description: `请检查 Base URL 与模型名称。${detail}` }
      case 400:
      case 422:
        if (/reasoning/i.test(detail)) {
          return { title: '模型不支持当前思考等级', description: `请在设置中换一个思考等级，或改为「模型默认」。${detail}` }
        }
        return { title: '请求失败', description: detail }
      case 413:
        return { title: '图片过大', description: '请在设置中降低编辑分辨率上限后重试' }
      case 429:
        return { title: '请求过于频繁或额度不足', description: detail }
      default:
        if (err.status && err.status >= 500) {
          return { title: '服务端错误', description: `服务暂时不可用（${err.status}），请稍后重试` }
        }
        return { title: '请求失败', description: detail }
    }
  }
  if (err instanceof AnalysisFormatError) {
    return { title: '模型输出格式不正确', description: err.message }
  }
  if (err instanceof Error) {
    return { title: '操作失败', description: err.message }
  }
  return { title: '操作失败', description: String(err) }
}

function describeModeration(details: ModerationDetails | undefined): FriendlyError {
  const categories = (details?.categories ?? []).map(c => MODERATION_CATEGORY_LABELS[c] ?? c)
  const categoryText = categories.length ? `（类别：${categories.join('、')}）` : ''
  const advice = details?.moderation_stage === 'output'
    ? '生成结果未通过审核，可以换一种描述或调整区域后重新生成'
    : '输入的图片或指令未通过审核，请修改指令措辞或更换区域'
  return { title: `内容审核未通过${categoryText}`, description: advice }
}
