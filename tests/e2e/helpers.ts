import type { Page } from '@playwright/test'

/**
 * 让配置向导不弹出。向导在启动时没有读图 Key 就会浮在页面上挡住操作，不涉及模型接口的用例预置一个 Key 即可；
 * 只在还没有存档时写入，刷新或用例里改动设置之后不会被覆盖。预置了读图 Key 与模型的用例不需要调用
 */
export async function skipSetupWizard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('apm-settings') === null) {
      localStorage.setItem('apm-settings', JSON.stringify({ vision: { apiKey: 'e2e-key' } }))
    }
  })
}
