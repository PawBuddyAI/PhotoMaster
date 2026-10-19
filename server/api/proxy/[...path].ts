import { PROXY_TARGET_HEADER } from '#shared/proxy'

/**
 * 可选的 CORS 兜底代理：把 /api/proxy/<path> 原样转发到请求头指定的 OpenAI 兼容服务。
 * 仅在以 nuxt dev 或 Node 服务方式运行时存在；纯静态部署时前端应使用直连模式。
 */
export default defineEventHandler(async (event) => {
  const target = getRequestHeader(event, PROXY_TARGET_HEADER)
  if (!target || !/^https?:\/\//i.test(target)) {
    throw createError({ statusCode: 400, statusMessage: `缺少或无效的 ${PROXY_TARGET_HEADER} 请求头` })
  }
  const path = getRouterParam(event, 'path') ?? ''
  const { search } = getRequestURL(event)
  return proxyRequest(event, `${target.replace(/\/+$/, '')}/${path}${search}`)
})
