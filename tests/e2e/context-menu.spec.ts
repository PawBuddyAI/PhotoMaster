import { expect, type Locator, type Page, test } from '@playwright/test'

/**
 * 右键菜单：工程卡片、侧栏相册、图层、画布。不涉及模型接口。
 * 菜单打开期间，被右键的对象带 data-state="open"（描蓝边）；菜单项与「更多操作」、行内按钮、工具条执行的是同一组操作。
 * 菜单打开时页面其余部分被标为 aria-hidden，按角色查找会找不到被右键的对象，所以卡片、相册行、图层行用 CSS 定位
 */
const PHOTO_NAME = 'context-menu-e2e'

const listItem = (page: Page, text: string) => page.locator('li').filter({ hasText: text })
const albumRow = (page: Page, name: string) => page.locator('nav[aria-label="主导航"] a').filter({ hasText: name })

/** 在浏览器里生成一张小照片并返回 base64 */
async function makePhoto(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const canvas = new OffscreenCanvas(400, 300)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#c86b3c'
    ctx.fillRect(0, 0, 400, 300)
    ctx.fillStyle = '#2f5f8a'
    ctx.fillRect(0, 0, 400, 140)
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return btoa(binary)
  })
}

async function importPhoto(page: Page): Promise<void> {
  const photoB64 = await makePhoto(page)
  await page.locator('input[type=file]').setInputFiles({ name: `${PHOTO_NAME}.png`, mimeType: 'image/png', buffer: Buffer.from(photoB64, 'base64') })
  await page.waitForURL(/\/editor\//)
  await expect(page.getByText('正在加载图像')).toBeHidden()
}

/** 图标选项的单选按钮是视觉隐藏的，用户点的是包住它的方格（label） */
async function pick(option: Locator): Promise<void> {
  await option.locator('xpath=ancestor::label[1]').click()
}

test('工程卡片与侧栏相册：右键移入移出相册、在侧栏就地重命名、更换图标、删除相册与工程', async ({ page }) => {
  await page.goto('/')
  const sidebar = page.getByRole('navigation', { name: '主导航' })
  for (const name of ['甲', '乙']) {
    await sidebar.getByRole('button', { name: '新建相册' }).click()
    const dialog = page.getByRole('dialog', { name: '新建相册' })
    await dialog.getByRole('textbox', { name: '名称' }).fill(name)
    await dialog.getByRole('textbox', { name: '名称' }).press('Enter')
    await expect(dialog).toBeHidden()
  }
  await sidebar.getByRole('link', { name: /图库/ }).click()
  await page.waitForURL(url => url.pathname === '/')
  await importPhoto(page)
  await page.getByRole('link', { name: '返回图库' }).click()
  await page.waitForURL(url => url.pathname === '/')

  // 右键卡片：卡片描边，菜单与「更多操作」相同
  const card = listItem(page, PHOTO_NAME)
  const cardTrigger = card.locator('[data-state]').first()
  await expect(cardTrigger).toHaveAttribute('data-state', 'closed')
  await card.click({ button: 'right' })
  await expect(cardTrigger).toHaveAttribute('data-state', 'open')
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem')).toHaveText(['移到相册', '删除工程'])
  await menu.getByRole('menuitem', { name: '移到相册' }).click()
  await page.getByRole('menuitem', { name: '乙' }).click()
  const albumB = albumRow(page, '乙')
  await expect(albumB.locator('span').last()).toHaveText('1')
  await expect(cardTrigger).toHaveAttribute('data-state', 'closed')

  // 工程在相册里时多出「移出相册」
  await card.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '移出相册' }).click()
  await expect(albumB.locator('span').last()).toHaveText('0')

  // 侧栏右键重命名：就在这一行改名，打开即聚焦；不是当前相册时留在原页面
  const albumA = albumRow(page, '甲')
  await albumA.click({ button: 'right' })
  await expect(albumA).toHaveAttribute('data-state', 'open')
  await page.getByRole('menuitem', { name: '重命名相册' }).click()
  const nameInput = sidebar.getByRole('textbox', { name: '相册名称' })
  await expect(nameInput).toHaveValue('甲')
  await expect(page.getByRole('menu')).toBeHidden()
  // 菜单关闭后焦点仍在输入框里，而不是回到右键前的位置
  await expect(nameInput).toBeFocused()
  await nameInput.fill('海边')
  await nameInput.press('Enter')
  await expect(nameInput).toBeHidden()
  const renamed = albumRow(page, '海边')
  await expect(renamed).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/')

  // Esc 放弃改名
  await renamed.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '重命名相册' }).click()
  await expect(nameInput).toBeFocused()
  await nameInput.fill('不要')
  await nameInput.press('Escape')
  await expect(nameInput).toBeHidden()
  await expect(renamed).toBeVisible()

  // 更换图标：弹窗标出当前选择，完成后侧栏显示 emoji
  await renamed.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '更换图标' }).click()
  const emojiDialog = page.getByRole('dialog', { name: '更换图标' })
  await expect(emojiDialog.getByRole('radio', { name: '照片封面' })).toBeChecked()
  await pick(emojiDialog.getByRole('radio', { name: '旅行', exact: true }))
  await emojiDialog.getByRole('button', { name: '完成' }).click()
  await expect(emojiDialog).toBeHidden()
  await expect(renamed).toContainText('✈️')

  // 删除不在看的相册：留在图库
  await renamed.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '删除相册' }).click()
  const deleteDialog = page.getByRole('dialog', { name: '删除相册' })
  await expect(deleteDialog).toContainText('确定删除相册「海边」吗？其中的 0 个工程不会被删除')
  await deleteDialog.getByRole('button', { name: '删除相册' }).click()
  await expect(renamed).toBeHidden()
  expect(new URL(page.url()).pathname).toBe('/')

  // 删除正在看的相册：先回到图库
  await albumB.click()
  await page.waitForURL(/\/albums\//)
  await albumB.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '删除相册' }).click()
  await deleteDialog.getByRole('button', { name: '删除相册' }).click()
  await page.waitForURL(url => url.pathname === '/')
  await expect(sidebar.getByText('还没有相册')).toBeVisible()

  // 右键删除工程
  await card.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '删除工程' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
  await expect(card).toBeHidden()
})

test('图层与画布：右键选中并整理图层，在画布上切换工具与撤销', async ({ page }) => {
  await page.goto('/')
  await importPhoto(page)
  await page.getByRole('tab', { name: /图层/ }).click()
  await page.getByRole('button', { name: '调整图层' }).click()
  await page.getByRole('button', { name: '调整图层' }).click()
  const layer = (name: string) => listItem(page, name)
  const first = layer('调整 1')

  // 右键选中图层并描边；最下面的图层不能再下移
  await first.click({ button: 'right' })
  await expect(first.locator('[data-state]').first()).toHaveAttribute('data-state', 'open')
  await expect(first.locator('[aria-current="true"]')).toHaveCount(1)
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: '下移' })).toBeDisabled()
  await menu.getByRole('menuitem', { name: '上移' }).click()
  await expect(page.locator('li').first()).toContainText('调整 1')
  await expect(page.getByRole('heading', { name: '调整 1' })).toBeVisible()

  // 隐藏与行内的眼睛按钮是同一操作，菜单文字随状态变化
  await first.click({ button: 'right' })
  await expect(menu.getByRole('menuitem', { name: '上移' })).toBeDisabled()
  await menu.getByRole('menuitem', { name: '隐藏图层' }).click()
  await expect(first.getByRole('button', { name: '显示图层' })).toBeVisible()
  await first.click({ button: 'right' })
  await expect(menu.getByRole('menuitem', { name: '显示图层' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()

  // 重命名：输入框打开即聚焦，菜单淡出后焦点不会被拿走
  await first.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: '重命名' }).click()
  const nameInput = page.getByRole('textbox', { name: '图层名称' })
  await expect(menu).toBeHidden()
  await expect(nameInput).toBeFocused()
  await nameInput.fill('天空')
  await nameInput.press('Enter')
  await expect(layer('天空')).toBeVisible()

  await layer('天空').click({ button: 'right' })
  await menu.getByRole('menuitem', { name: '删除图层' }).click()
  await expect(layer('天空')).toBeHidden()

  // 画布：撤销重做、工具（当前工具打勾）与视图
  const stage = page.locator('.konvajs-content')
  await stage.click({ button: 'right' })
  await expect(menu.getByRole('menuitem')).toContainText(['撤销', '重做', '放大', '缩小', '适应窗口', '原始像素'])
  await expect(menu.getByRole('menuitemcheckbox', { name: '选择 / 平移' })).toHaveAttribute('aria-checked', 'true')
  await expect(menu.getByRole('menuitem', { name: '重做' })).toBeDisabled()
  await menu.getByRole('menuitemcheckbox', { name: '画笔添加区域' }).click()
  await expect(page.getByText('上涂抹添加区域')).toBeVisible()
  await stage.click({ button: 'right' })
  await expect(menu.getByRole('menuitemcheckbox', { name: '画笔添加区域' })).toHaveAttribute('aria-checked', 'true')
  await menu.getByRole('menuitem', { name: '撤销' }).click()
  await expect(layer('天空')).toBeVisible()
})
