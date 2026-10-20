import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const require = createRequire(import.meta.url)
/**
 * vue 是 nuxt 的传递依赖，pnpm 不会把它提升到根目录，也不能声明为直接依赖
 * （仓库里有按 TypeScript 版本区分的两份 vue，直接依赖会解析到另一份）。
 * 测试 stores 时从 pinia 所在位置解析，保证与 pinia 共用同一份 vue。
 */
const vueEntry = createRequire(require.resolve('pinia')).resolve('vue')

// 单元测试只覆盖 app/lib 与 app/stores 中与 DOM 无关的逻辑，在 node 环境中运行；浏览器相关能力由 Playwright 覆盖
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      'vue': vueEntry
    }
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node'
  }
})
