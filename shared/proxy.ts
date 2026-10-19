/** 前端与 Nitro 代理路由共享的约定：请求发往本站 PROXY_PATH，真实目标地址放在 PROXY_TARGET_HEADER 请求头中 */
export const PROXY_PATH = '/api/proxy'
export const PROXY_TARGET_HEADER = 'x-target-base-url'
