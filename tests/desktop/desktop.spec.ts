import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { type Browser, chromium, expect, type Page, test } from '@playwright/test'
import { startMockServer } from './mock-server'

/**
 * 桌面版端到端：在真实的 Tauri 窗口（WebView2）里跑导入 → 分析 → 流式重绘 → 取消 → 导出 → 修改后立即关窗再重启。
 * 模拟服务不返回任何 CORS 头且监听非默认端口，请求能成功即说明走的是 Rust 端；
 * 设置里故意打开「代理」，确认桌面版忽略它。WebView2 数据目录指向临时文件夹，不碰本机已安装应用的数据。
 *
 * wry 总是显式设置 WebView2 启动参数，WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 环境变量不生效，
 * 因此测试使用合并了 tauri.desktop-test.conf.json 的 debug 构建（仅多出远程调试端口）。
 */
const EXE = resolve(process.env.DESKTOP_EXE ?? 'src-tauri/target/debug/ai-photo-master.exe')
const CDP_PORT = 9333
const ORIGIN = 'http://tauri.localhost'
const IMAGE_W = 2400
const IMAGE_H = 1600
/** 重绘区域（归一化）：右下角的“路人” */
const GEN_REGION = { x0: 0.6, y0: 0.55, x1: 0.8, y1: 0.95 }
const PROMPT = 'Remove the person and fill with grass'

const ANALYSIS = {
  overall: '右下角有干扰物。',
  adjustments: [],
  generative_edits: [{
    title: '移除路人',
    reason: '干扰主体',
    prompt: PROMPT,
    region: { shape: 'rect', x0: GEN_REGION.x0 * 1000, y0: GEN_REGION.y0 * 1000, x1: GEN_REGION.x1 * 1000, y1: GEN_REGION.y1 * 1000 }
  }],
  crop: null
}

const settingsFor = (baseURL: string) => ({
  vision: { baseURL, apiKey: 'test-key', useProxy: true, model: 'mock-vision', reasoningEffort: 'default', structuredOutput: 'json_schema', detail: 'high' },
  image: { baseURL, apiKey: 'test-key', useProxy: true, sameAsVision: true, model: 'mock-image', quality: 'high', n: 2, sizeMode: 'custom', maxLongSide: 2048, stream: true, partialImages: 1 }
})

test.describe.configure({ mode: 'serial' })

let app: ChildProcess
let browser: Browser
let page: Page
let workDir: string
let userData: string
let mock: Awaited<ReturnType<typeof startMockServer>>
let photoB64 = ''
let generatedB64 = ''

/** 启动应用并经调试端口连接主窗口；数据目录固定为本次测试的临时文件夹，重启后沿用 */
async function launch() {
  app = spawn(EXE, [], {
    stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: userData }
  })
  browser = await connect(`http://127.0.0.1:${CDP_PORT}`)
  const context = browser.contexts()[0]!
  page = context.pages()[0] ?? await context.waitForEvent('page')
  await page.waitForURL(`${ORIGIN}/`)
}

test.beforeAll(async () => {
  // 测试配置整体替换窗口数组，除远程调试参数外必须与正式配置一致，否则测的不是发布出去的窗口
  const [release, desktopTest] = await Promise.all(['tauri.conf.json', 'tauri.desktop-test.conf.json']
    .map(async name => JSON.parse(await readFile(join('src-tauri', name), 'utf8')) as { app: { windows: Record<string, unknown>[] } }))
  const { additionalBrowserArgs, ...testWindow } = desktopTest!.app.windows[0]!
  expect(testWindow).toEqual(release!.app.windows[0])
  expect(additionalBrowserArgs).toContain(`--remote-debugging-port=${CDP_PORT}`)

  expect(existsSync(EXE), `找不到 ${EXE}，请先执行 pnpm tauri build --debug --no-bundle --config src-tauri/tauri.desktop-test.conf.json`).toBe(true)
  mock = await startMockServer({ analysis: ANALYSIS, generatedB64: () => generatedB64 })
  workDir = await mkdtemp(join(tmpdir(), 'apm-desktop-'))
  userData = join(workDir, 'webview')
  await launch()
  // 数据目录没有被重定向时立即停止，避免测试工程写进本机已安装应用的数据里
  expect(existsSync(join(userData, 'EBWebView')), 'WEBVIEW2_USER_DATA_FOLDER 未生效').toBe(true)
})

test.afterAll(async () => {
  await browser?.close()
  if (app?.pid) {
    await promisify(execFile)('taskkill', ['/pid', String(app.pid), '/t', '/f']).catch(() => {})
  }
  await mock?.close()
  // WebView2 子进程退出后才能删除数据目录
  await new Promise(resolve => setTimeout(resolve, 1000))
  await rm(workDir, { recursive: true, force: true }).catch(() => {})
})

test('运行在 Tauri 中：代理开关隐藏，测试连接与模型列表经 Rust 端直连无 CORS 头的服务', async () => {
  expect(await page.evaluate(() => (globalThis as { isTauri?: boolean }).isTauri)).toBe(true)
  await page.evaluate((settings) => {
    localStorage.setItem('apm-settings', JSON.stringify(settings))
  }, settingsFor(mock.baseURL))
  await page.goto(`${ORIGIN}/settings`)
  await expect(page.getByText('Base URL').first()).toBeVisible()
  await expect(page.getByText('通过本地代理转发')).toHaveCount(0)

  const testButtons = page.getByRole('button', { name: '测试连接' })
  await testButtons.first().click()
  await expect(page.getByText('读图模型连接正常', { exact: true })).toBeVisible()
  await testButtons.nth(1).click()
  await expect(page.getByText('修图模型连接正常', { exact: true })).toBeVisible()

  const chat = mock.requests.find(r => r.path === '/v1/chat/completions')!
  expect(chat.headers.authorization).toBe('Bearer test-key')
  expect(mock.requests.some(r => r.path === '/v1/models')).toBe(true)
  // 请求不经过浏览器：没有预检，也没有发往本站代理
  expect(mock.requests.filter(r => r.method === 'OPTIONS')).toHaveLength(0)
})

test('导入 → 分析 → 采纳 → 流式重绘 → 应用；编辑器页刷新后仍能打开', async () => {
  await page.goto(`${ORIGIN}/`)
  photoB64 = await makeImage(page, 'photo')
  generatedB64 = await makeImage(page, 'generated')
  await page.locator('input[type=file]').setInputFiles({ name: 'desktop.png', mimeType: 'image/png', buffer: Buffer.from(photoB64, 'base64') })
  await page.waitForURL(/\/editor\//)
  await expect(page.getByText('正在加载图像')).toBeHidden()

  await page.getByRole('button', { name: '分析照片' }).click()
  await expect(page.getByText(ANALYSIS.overall)).toBeVisible()
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByPlaceholder('例如：移除画面中的行人')).toHaveValue(PROMPT)

  const started = Date.now()
  await page.getByRole('button', { name: '生成', exact: true }).click()
  await expect(page.getByRole('button', { name: '应用所选' })).toBeVisible()
  const elapsed = Date.now() - started

  // 流式模式下每个候选单独请求；multipart 由 SDK 生成，经 Rust 端原样发出
  const edits = mock.requests.filter(r => r.path === '/v1/images/edits')
  expect(edits).toHaveLength(2)
  for (const edit of edits) {
    expect(edit.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    const form = edit.body.toString('latin1')
    expect(form).toContain('name="image"')
    expect(form).toContain('name="mask"')
    expect(form).toContain('Only change the masked area')
    expect(form).toMatch(/name="stream"\r\n\r\ntrue/)
    expect(form).toMatch(/name="partial_images"\r\n\r\n1/)
  }
  test.info().annotations.push({
    type: '重绘请求',
    description: `${edits.map(e => `${(e.body.length / 1024 / 1024).toFixed(2)} MB`).join('、')}，点击生成到出现候选 ${elapsed} ms`
  })

  await page.getByRole('button', { name: '应用所选' }).click()
  await expect(page.getByText('已应用重绘结果').first()).toBeVisible()
  // 自动保存有 600ms 防抖（stores/editor.ts 的 SAVE_DELAY），等它落盘后再刷新
  await page.waitForTimeout(1500)

  // 相当于用户按 F5：/editor/<id> 没有对应的静态文件，需回退到 SPA 入口
  await page.reload()
  await expect(page.getByText('正在加载图像')).toBeHidden()
  await expect(page.getByRole('button', { name: '重新分析当前效果' })).toBeVisible()
})

test('重绘中途取消：请求被中断，界面回到可生成状态且不报错', async () => {
  mock.state.holdEdits = true
  try {
    await page.getByRole('tab', { name: /图层/ }).click()
    await page.getByText('移除路人', { exact: true }).first().click()
    const editsBefore = mock.requests.filter(r => r.path === '/v1/images/edits').length
    await page.getByRole('button', { name: '重新生成' }).click()
    // 等服务端收到完整请求、正在等待响应时再取消，验证的是“请求已发出”后的中断
    await expect.poll(() => mock.requests.filter(r => r.path === '/v1/images/edits').length).toBeGreaterThan(editsBefore)
    await page.getByRole('button', { name: '取消生成' }).click()
    await expect(page.getByRole('button', { name: '重新生成' })).toBeVisible()
    // 流式模式下每个候选是一个并行请求：已发到服务端的请求都应被中断
    const sentSince = () => mock.requests.filter(r => r.path === '/v1/images/edits').length - editsBefore
    await expect.poll(() => mock.state.abortedEdits > 0 && mock.state.abortedEdits === sentSince()).toBe(true)
    // 取消不算失败：任务被丢弃、面板里没有错误说明（.text-error），已应用的结果仍在
    await expect(page.locator('.text-error')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '移除结果', exact: true })).toBeVisible()
  } finally {
    mock.state.holdEdits = false
  }
})

test('导出：另存为对话框取消时不导出；保存后写入所选路径，尺寸为原图且蒙版外像素不变', async () => {
  const target = join(workDir, '导出 结果.png')
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox').click()
  await page.getByRole('option', { name: 'PNG（无损）' }).click()

  await dialog.getByRole('button', { name: '导出', exact: true }).click()
  await driveSaveDialog(app.pid!, 'cancel')
  await expect(dialog.getByRole('button', { name: '导出', exact: true })).toBeEnabled()
  await expect(page.getByText('导出完成')).toHaveCount(0)
  expect(existsSync(target)).toBe(false)

  await dialog.getByRole('button', { name: '导出', exact: true }).click()
  await driveSaveDialog(app.pid!, 'save', target)
  await expect(page.getByText('导出完成', { exact: true })).toBeVisible()
  // 通知的读屏播报区里有同样的文字，只在通知区域内查找
  await expect(page.getByRole('region', { name: /通知/ }).getByText(`已保存到 ${target}`)).toBeVisible()

  const exported = await readFile(target)
  const stats = await page.evaluate(async ({ exportedB64, originalB64, region }) => {
    const decode = async (b64: string) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      return { w: bitmap.width, h: bitmap.height, data: canvas.getContext('2d')!.getImageData(0, 0, bitmap.width, bitmap.height).data }
    }
    const out = await decode(exportedB64)
    const orig = await decode(originalB64)
    const [rx0, ry0, rx1, ry1] = [region.x0 * orig.w, region.y0 * orig.h, region.x1 * orig.w, region.y1 * orig.h]
    let outsideMax = 0
    let insideSum = 0
    let insideCount = 0
    for (let y = 0; y < orig.h; y++) {
      for (let x = 0; x < orig.w; x++) {
        const i = (y * orig.w + x) * 4
        const diff = Math.max(Math.abs(out.data[i]! - orig.data[i]!), Math.abs(out.data[i + 1]! - orig.data[i + 1]!), Math.abs(out.data[i + 2]! - orig.data[i + 2]!))
        if (!(x > rx0 && x < rx1 && y > ry0 && y < ry1)) {
          outsideMax = Math.max(outsideMax, diff)
        } else if (x > rx0 + 80 && x < rx1 - 80 && y > ry0 + 80 && y < ry1 - 80) {
          insideSum += diff
          insideCount++
        }
      }
    }
    return { size: [out.w, out.h], outsideMax, insideMean: insideSum / insideCount }
  }, { exportedB64: exported.toString('base64'), originalB64: photoB64, region: GEN_REGION })

  expect(stats.size).toEqual([IMAGE_W, IMAGE_H])
  expect(stats.outsideMax).toBeLessThanOrEqual(1)
  expect(stats.insideMean).toBeGreaterThan(10)
  test.info().annotations.push({ type: '导出文件', description: `${(exported.length / 1024 / 1024).toFixed(2)} MB` })
})

test('应用后立即关闭窗口：补存完成才关窗，重启后结果仍在', async () => {
  // 先移除结果并等它落盘：重启后若还能看到结果，只能来自关窗时的补存
  await page.getByRole('button', { name: '移除结果', exact: true }).click()
  await expect(page.getByRole('button', { name: '生成', exact: true })).toBeVisible()
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()

  const closeWindow = await prepareWindowClose(app.pid!)
  await page.getByRole('button', { name: '生成', exact: true }).click()
  await page.getByRole('button', { name: '应用所选' }).click()
  // 在页面里等到结果写入图层（出现「移除结果」）的那一刻读取保存状态，随即发出关闭请求
  const stateAtClose = await page.evaluate(() => new Promise<string>((resolve) => {
    const labels = ['已保存', '未保存', '保存中…', '保存失败']
    const poll = () => {
      if (![...document.querySelectorAll('button')].some(b => b.textContent?.trim() === '移除结果')) {
        setTimeout(poll, 5)
        return
      }
      const label = [...document.querySelectorAll('span')].map(s => s.textContent?.trim() ?? '').find(t => labels.includes(t))
      resolve(label ?? '')
    }
    poll()
  }))
  const projectUrl = page.url()
  const exited = new Promise<void>(resolve => app.once('exit', () => resolve()))
  const disconnected = new Promise<void>(resolve => browser.once('disconnected', () => resolve()))
  const closeAt = Date.now()
  closeWindow()
  // 关闭请求发出时修改还在防抖中，没有写入
  expect(stateAtClose).toBe('未保存')

  // 补存最多等 5 秒（CLOSE_SAVE_TIMEOUT），窗口必须能关掉
  const closed = await Promise.race([exited.then(() => true), new Promise<boolean>(resolve => setTimeout(resolve, 15_000, false))])
  expect(closed, '发出关闭请求 15 秒后窗口仍未关闭').toBe(true)
  test.info().annotations.push({ type: '关闭耗时', description: `${Date.now() - closeAt} ms` })
  await disconnected

  await launch()
  await page.goto(projectUrl)
  await expect(page.getByText('正在加载图像')).toBeHidden()
  await page.getByRole('tab', { name: /图层/ }).click()
  await page.getByText('移除路人', { exact: true }).first().click()
  await expect(page.getByRole('button', { name: '移除结果', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '重新生成' })).toBeVisible()
})

/** 应用启动后远程调试端口才就绪，轮询连接 */
async function connect(endpoint: string): Promise<Browser> {
  const deadline = Date.now() + 30_000
  for (;;) {
    try {
      return await chromium.connectOverCDP(endpoint)
    } catch (err) {
      if (Date.now() > deadline) {
        throw err
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
}

/**
 * 操作应用弹出的「另存为」对话框：填写完整路径后保存，或直接取消。
 * 用 UI 自动化按进程找到对话框，再按通用文件对话框固定的控件 ID（文件名 1001、保存 1、取消 2）取句柄发送窗口消息。
 * 脚本以 -EncodedCommand（UTF-16LE）传入，中文路径不受控制台代码页影响。
 */
async function driveSaveDialog(pid: number, action: 'save' | 'cancel', path = '') {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
function New-Cond($property, $value) { New-Object System.Windows.Automation.PropertyCondition($property, $value) }
function Find-SaveDialog {
  foreach ($window in $AE::RootElement.FindAll($Scope::Children, (New-Cond $AE::ProcessIdProperty ${pid}))) {
    if ($window.Current.ClassName -eq '#32770') { return $window }
    $owned = $window.FindFirst($Scope::Children, (New-Cond $AE::ClassNameProperty '#32770'))
    if ($owned) { return $owned }
  }
}
$deadline = (Get-Date).AddSeconds(20)
do { $dialog = Find-SaveDialog; if ($dialog) { break }; Start-Sleep -Milliseconds 200 } while ((Get-Date) -lt $deadline)
if (-not $dialog) { throw '未找到另存为对话框' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SaveDialogWin32 {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, string lParam);
}
'@
# 文件名框与按钮是原生 Win32 控件，托管 UI 自动化只把它们识别为没有交互模式的 Pane，
# 因此按 AutomationId + 窗口类名取句柄，直接发送 WM_SETTEXT / BM_CLICK（地址栏也用 1001，靠类名区分）
function Get-Handle($id, $class) {
  $condition = New-Object System.Windows.Automation.AndCondition((New-Cond $AE::AutomationIdProperty $id), (New-Cond $AE::ClassNameProperty $class))
  $element = $dialog.FindFirst($Scope::Descendants, $condition)
  if (-not $element) { throw "未找到 AutomationId 为 $id 的 $class 控件" }
  [IntPtr]$element.Current.NativeWindowHandle
}
$WM_SETTEXT = 0x000C
$BM_CLICK = 0x00F5
if ('${action}' -eq 'save') {
  [void][SaveDialogWin32]::SendMessage((Get-Handle '1001' 'Edit'), $WM_SETTEXT, [IntPtr]::Zero, '${path.replaceAll('\'', '\'\'')}')
  [void][SaveDialogWin32]::SendMessage((Get-Handle '1' 'Button'), $BM_CLICK, [IntPtr]::Zero, $null)
} else {
  [void][SaveDialogWin32]::SendMessage((Get-Handle '2' 'Button'), $BM_CLICK, [IntPtr]::Zero, $null)
}
`
  await promisify(execFile)('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')])
}

/**
 * 准备关闭应用主窗口，返回发出关闭请求的函数：向主窗口投递 WM_CLOSE，与点标题栏关闭按钮走同一条路径。
 * PowerShell 启动并编译 Win32 声明要一两秒，所以提前启动、就绪后等待标准输入的信号，
 * 关闭请求才能赶在自动保存的防抖（600ms）之前发出。
 */
async function prepareWindowClose(pid: number): Promise<() => void> {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CloseWin32 {
  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
'@
$hwnd = (Get-Process -Id ${pid}).MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { throw '未找到应用主窗口' }
[Console]::Out.WriteLine('ready')
[void][Console]::In.ReadLine()
$WM_CLOSE = 0x0010
if (-not [CloseWin32]::PostMessage($hwnd, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)) { throw '投递 WM_CLOSE 失败' }
`
  const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')])
  let stderr = ''
  ps.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  await new Promise<void>((resolve, reject) => {
    ps.stdout.on('data', (chunk) => {
      if (String(chunk).includes('ready')) {
        resolve()
      }
    })
    ps.once('exit', code => reject(new Error(`关闭窗口脚本提前退出（${code}）：${stderr}`)))
  })
  return () => {
    ps.stdin.end('close\n')
  }
}

/** 在 WebView 里生成测试图片并返回 base64：照片带确定性噪声，体积接近真实照片，便于观察大请求经 IPC 的开销 */
async function makeImage(target: Page, kind: 'photo' | 'generated'): Promise<string> {
  return target.evaluate(async ({ kind, w, h }) => {
    const width = kind === 'photo' ? w : 1024
    const height = kind === 'photo' ? h : 1024
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')!
    if (kind === 'photo') {
      const image = ctx.createImageData(width, height)
      let seed = 42
      for (let y = 0; y < height; y++) {
        const sky = y < height * 0.55
        for (let x = 0; x < width; x++) {
          seed = (seed * 1664525 + 1013904223) >>> 0
          const noise = (seed >>> 24) % 24 - 12
          const i = (y * width + x) * 4
          image.data[i] = (sky ? 170 + y % 40 : 50 + y % 20) + noise
          image.data[i + 1] = (sky ? 200 - y % 30 : 80 + y % 25) + noise
          image.data[i + 2] = (sky ? 235 : 40) + noise
          image.data[i + 3] = 255
        }
      }
      ctx.putImageData(image, 0, 0)
      ctx.fillStyle = '#202020'
      ctx.fillRect(width * 0.66, height * 0.6, width * 0.06, height * 0.3)
    } else {
      ctx.fillStyle = '#3a6a2a'
      ctx.fillRect(0, 0, width, height)
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return btoa(binary)
  }, { kind, w: IMAGE_W, h: IMAGE_H })
}
