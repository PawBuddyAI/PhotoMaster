import { defineConfig } from '@playwright/test'

/**
 * 桌面版测试：启动开启了远程调试端口（9333）的 debug 构建，通过 WebView2 调试协议连接真实窗口。
 * 运行前先执行 `pnpm tauri build --debug --no-bundle --config src-tauri/tauri.desktop-test.conf.json`；
 * exe 路径可用 DESKTOP_EXE 覆盖。仅限 Windows：另存为对话框由 PowerShell UI 自动化操作。
 */
export default defineConfig({
  testDir: 'tests/desktop',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list'
})
