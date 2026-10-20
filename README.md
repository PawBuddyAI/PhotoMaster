# AI 修图

纯前端的 AI 修图工具：多模态 LLM 读图给出修图方案，曝光、白平衡等调色在本地 GPU 上无损完成（可限定区域），去路人、换天空等内容修改通过 OpenAI 兼容的 `images/edits` 局部重绘。

基于 Nuxt 4 + Nuxt UI v4，以 SPA 方式运行，不需要自建后端；另有 Tauri 2 打包的 Windows 桌面版。

## 功能

- **AI 读图建议**：读图模型返回三类建议——参数化调色（全图或局部区域）、生成式重绘、构图裁剪。每条建议都可以一键采纳为图层，再继续微调。
- **区域调色图层**：曝光、对比度、高光、阴影、黑白色阶、色温、色调、自然饱和度、饱和度、清晰度、锐化。每个图层可以限定区域：全图、矩形、椭圆（羽化）、线性渐变，或仅由画笔决定；支持画笔添加和擦除、反转、强度。
- **局部重绘**：用矩形、椭圆或画笔圈出区域，并填写指令；每次生成多张候选供挑选。结果只替换蒙版内的像素，蒙版外与原图逐位一致。
- **裁剪与水平校正**：旋转后裁剪框自动收缩到无空白角的最大区域，支持多种长宽比。
- **非破坏式编辑**：图层可以开关、排序、删除，支持撤销和重做，工程自动保存在浏览器（IndexedDB）中。修改停顿 0.6 秒后写入；页面切到后台、刷新或关闭时立即补存，关闭时如果还有修改没写完，浏览器会先请求确认。
- **全分辨率导出**：在 Worker 中分块渲染，导出尺寸为原图尺寸，支持 JPEG / PNG / WebP；JPEG 原图可保留 EXIF。
- **图库与相册**：图库列出全部工程，相册用来分组整理，结构与 macOS「照片」相同。在侧栏新建相册，可以给相册选一个 emoji 做图标，不选时显示相册里最近修改的那张照片；在相册里导入的照片直接放进该相册，已有工程可以通过卡片的「更多操作」移入或移出。一个工程最多属于一个相册，删除相册不会删除其中的工程。

## 为什么不直接“读图 → 蒙版 → images/edits”

1. **GPT Image 的蒙版只是提示**：模型会重画整张输入图，蒙版外也可能变化。本项目的做法是只把蒙版附近区域裁出来送去编辑，结果回来后，在环带上做色彩统计匹配，再以羽化蒙版作为 alpha 贴回原图。
2. **编辑分辨率有上限**：任意尺寸要求宽高是 16 的倍数、比例 ≤ 3:1、最大 3840×2160。裁剪后再编辑，可以保留原图的全分辨率。
3. **调色交给本地处理**：参数化 GPU 管线无损、实时、零成本，调色参数可随时修改，不需要重新生成。

## 快速开始

```bash
pnpm install
pnpm dev
```

打开 http://localhost:3000，在「设置」中填写 OpenAI 兼容接口的 Base URL、API Key 和模型名：

| 用途 | 默认模型 | 说明 |
|---|---|---|
| 读图 | `gpt-6.1-sol` | 需要支持图像输入；测试连接时会自动检测结构化输出能力（json_schema → json_object → 纯提示词） |
| 修图 | `gpt-image-2.5-sunburst` | 旧模型或只支持固定尺寸的兼容服务，请把「尺寸模式」切换为固定尺寸 |

浏览器会直接请求你配置的接口。如果该服务不支持浏览器跨域（CORS），请在设置中开启「通过本地代理转发」；这个功能需要以 `pnpm dev` 或 `node .output/server/index.mjs` 方式运行。

### 部署

```bash
pnpm build      # Node 服务，包含可选的 CORS 代理：node .output/server/index.mjs
pnpm generate   # 纯静态站点（.output/public），只能使用直连模式
```

### 工程数据

工程保存在 IndexedDB 数据库 `ai-photo-master` 中（桌面版位于下文的 WebView2 数据目录），分四张表：

| 表 | 内容 |
|---|---|
| `projects` | 名称、尺寸、原图类型、缩略图等元数据，以及所属相册 `albumId`（不在相册中的工程没有这一项） |
| `docs` | 工程文档（图层、裁剪、读图结果、已采纳的建议）与最近修改时间，主键为工程 id |
| `blobs` | 原图与重绘补丁 |
| `albums` | 相册名称、创建时间与可选的 emoji 图标 `emoji`（不建索引，加入这一项不需要升级数据库版本） |

自动保存只写 `docs` 中的一行：发出一个写请求后立即提交事务，即使紧接着刷新或关闭页面，写入也能完成。把工程移入或移出相册只改 `projects` 中的 `albumId`，不改变工程的修改时间。

数据库升级在第一次打开时自动完成：

- 版本 1 → 2：旧版本的工程文档存在 `projects` 表中，迁移到 `docs` 表
- 版本 2 → 3：新增 `albums` 表与 `projects.albumId` 索引，已有工程不属于任何相册，内容不变

升级后，旧版本无法再打开这个数据库。如果需要回退，请先在新版本中导出要保留的照片，再清除本站数据（桌面版删除其数据目录）。

### Windows 桌面版

用 Tauri 2 打包，界面与网页版相同，运行在系统自带的 WebView2（Edge 内核）中。与网页版的区别：

- 请求由 Rust 端直接发出，不受跨域限制，设置里不显示「通过本地代理转发」
- 导出时弹出系统「另存为」对话框，默认打开上次保存的文件夹
- 关闭窗口时先写入还没保存的修改再关闭，最多等 5 秒；保存失败或超时会弹出对话框，可以放弃修改关闭，也可以返回编辑
- 工程数据保存在 `%LOCALAPPDATA%\com.k99k5.ai-photo-master\EBWebView`，与浏览器中的网页版互不相通

构建需要 Rust 1.90 以上与 Visual Studio C++ 生成工具：

```bash
pnpm tauri dev      # 开发：启动 3000 端口的开发服务器并打开桌面窗口
pnpm tauri build    # 打包：src-tauri/target/release/bundle/nsis/ 下生成安装包
```

- 由 Tauri 启动的开发服务器与打包使用独立的构建目录（`node_modules/.cache/nuxt-tauri`），另一个 `pnpm dev` 运行时也能打包
- 安装包按当前用户安装，不需要管理员权限；Windows 11 自带 WebView2，缺少时安装器会联网下载
- 安装包未签名，首次运行会出现 SmartScreen 提示
- 发布后不要修改 `src-tauri/tauri.conf.json` 中的 `identifier`：数据目录随之改变，已有工程会「消失」
- 图标源文件是 `public/app-icon.svg`（启动画面也直接显示它），修改后执行 `pnpm tauri icon public/app-icon.svg`，删除生成的 `android`、`ios` 目录，再把 `src-tauri/icons/icon.ico` 复制为 `public/favicon.ico`

### 快捷键

| 按键 | 作用 |
|---|---|
| `V` / `B` / `E` / `C` | 选择、画笔添加、画笔擦除、裁剪 |
| `[` / `]` | 缩小、放大笔刷 |
| 按住 `\` | 对比原图 |
| `Space` + 拖动 / 鼠标中键 | 平移画布 |
| 滚轮 | 以指针为中心缩放 |
| `0` | 适应窗口 |
| `Ctrl+Z` / `Ctrl+Shift+Z` | 撤销、重做 |

## 目录结构

```
app/
  lib/            纯逻辑（不依赖 Nuxt，可在主线程、Worker、node 测试中复用）
    pipeline/     WebGL2 调色管线（着色器、渲染器、图层构建）
    mask/         区域模型与栅格化
    inpaint/      重绘尺寸规划、色彩匹配、补丁合成、Worker 收尾
    llm/          OpenAI 兼容客户端、读图分析（含降级）、images/edits、错误说明
    geometry/     裁剪与旋转几何
    image/        画布工具、底图合成、EXIF、分块导出
    storage/      IndexedDB（Dexie）
    project/      工程文档模型、退出前补存
  stores/         Pinia：设置、图库与相册、编辑会话（撤销/自动保存）、读图、重绘任务
  plugins/        Konva 注册；页面卸载与窗口关闭前补存
  composables/    预览渲染、资源缓存、Worker、导出、提示
  components/     编辑器界面（画布、图层、区域工具、参数、建议、重绘、裁剪、导出）、工程网格、侧栏导航
  workers/        图像计算 Worker（导出、重绘收尾）
server/api/proxy  可选的 CORS 代理
shared/           前端与服务端共享的常量
src-tauri/        Windows 桌面壳（窗口与打包配置、插件权限、图标）
tests/unit        Vitest 单元测试
tests/e2e         Playwright 浏览器测试
tests/desktop     桌面版端到端测试
```

## 测试

```bash
pnpm test        # 单元测试（node 环境）
pnpm test:e2e    # 浏览器测试：WebGL 管线 + 端到端流程（接口由 page.route 模拟）
pnpm lint
pnpm typecheck
```

浏览器测试默认使用本机 Edge。其他环境可以先执行 `pnpm exec playwright install chromium`，再设置 `PW_CHANNEL=chromium` 运行。测试默认复用（或自动启动）3210 端口的开发服务器，可通过 `PW_PORT` 修改。

桌面版测试连接真实的桌面窗口，需要先构建一个开启了 WebView2 远程调试端口（9333）的 debug 版本，输出到 `src-tauri/target/debug/`，不影响发布版与安装包：

```bash
pnpm tauri build --debug --no-bundle --config src-tauri/tauri.desktop-test.conf.json
```

```bash
pnpm exec playwright test -c playwright.desktop.config.ts
```

wry 总是显式设置 WebView2 启动参数，`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量不生效，所以调试端口只能写进合并配置。`tauri.desktop-test.conf.json` 会整体替换窗口配置，测试开始时会校验它除调试参数外与 `tauri.conf.json` 一致。WebView2 数据目录指向临时文件夹，不影响本机已安装应用的工程数据（debug 版仍会在 `%LOCALAPPDATA%\com.k99k5.ai-photo-master` 下写入空的日志与 cookie 文件）。模拟接口不返回任何 CORS 响应头，另存为对话框由 Windows UI 自动化操作。最后一项用例在应用重绘结果后、自动保存的防抖到期前向主窗口投递 `WM_CLOSE`（与点标题栏关闭按钮相同），再以同一数据目录重启，确认修改已经写入。
