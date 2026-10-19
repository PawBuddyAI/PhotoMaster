import { defineConfig } from '@playwright/test'

/**
 * 浏览器测试：WebGL 调色管线与端到端流程。
 * 默认使用本机 Edge（Windows 自带，无需下载浏览器）；
 * 其他环境可先执行 `pnpm exec playwright install chromium`，再设置 PW_CHANNEL=chromium。
 */
const channel = process.env.PW_CHANNEL ?? 'msedge'
const port = Number(process.env.PW_PORT ?? 3210)

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    ...(channel === 'chromium' ? {} : { channel })
  },
  webServer: {
    command: `pnpm dev --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 240_000
  }
})
