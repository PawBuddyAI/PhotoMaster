import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 单元测试只覆盖 app/lib 中与 DOM 无关的纯逻辑，在 node 环境中运行；浏览器相关能力由 Playwright 覆盖
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '#shared': fileURLToPath(new URL('./shared', import.meta.url))
    }
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node'
  }
})
