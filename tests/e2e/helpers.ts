import type { Page } from '@playwright/test'

/**
 * 记为已走过首次配置向导。不涉及模型接口的用例从全新状态打开应用，向导会浮在页面上挡住操作；
 * 预置了读图 Key 与模型的用例不需要，应用启动时会自动记为已完成
 */
export async function skipSetupWizard(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('apm-setup', 'done'))
}
