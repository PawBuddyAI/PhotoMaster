# AI 修图

纯前端的 AI 修图工具：多模态 LLM 读图给出修图方案，曝光、白平衡等调色在本地 GPU 上无损完成（可限定区域），去路人、换天空等内容修改通过 OpenAI 兼容的 `images/edits` 局部重绘。

基于 Nuxt 4 + Nuxt UI v4，以 SPA 方式运行，不需要自建后端；另有 Tauri 2 打包的 Windows 桌面版。

## 功能

- **AI 读图建议**：读图模型返回三类建议——参数化调色（全图或局部区域）、生成式重绘、构图裁剪。每条建议都可以一键采纳为图层，再继续微调。分析以流式输出，过程中实时显示模型的思考过程（服务返回 `reasoning_content` / `reasoning` 或 `<think>` 标签时）和正在写出的总评与建议标题，不显示 JSON 本身。
- **区域调色图层**：曝光、对比度、高光、阴影、黑白色阶、色温、色调、自然饱和度、饱和度、清晰度、锐化。每个图层可以限定区域：全图、矩形、椭圆（羽化）、线性渐变，或仅由画笔决定；支持画笔添加和擦除、反转、强度。
- **局部重绘**：用矩形、椭圆或画笔圈出区域，并填写指令；每次生成多张候选供挑选。结果只替换蒙版内的像素，蒙版外与原图逐位一致。
- **裁剪与水平校正**：旋转后裁剪框自动收缩到无空白角的最大区域，支持多种长宽比。
- **非破坏式编辑**：图层可以开关、排序、删除，支持撤销和重做，工程自动保存在浏览器（IndexedDB）中。修改停顿 0.6 秒后写入；页面切到后台、刷新或关闭时立即补存，关闭时如果还有修改没写完，浏览器会先请求确认。
- **全分辨率导出**：在 Worker 中分块渲染，导出尺寸为原图尺寸，支持 JPEG / PNG / WebP；JPEG 原图可保留 EXIF。
- **图库与相册**：图库列出全部工程，相册用来分组整理，结构与 macOS「照片」相同。在侧栏新建相册，可以给相册选一个 emoji 做图标，不选时显示相册里最近修改的那张照片；在相册里导入的照片直接放进该相册，已有工程可以直接把卡片拖到侧栏的相册上移进去（拖到「图库」上移出相册），也可以通过卡片的「更多操作」或右键菜单移入或移出。一个工程最多属于一个相册，删除相册不会删除其中的工程。
- **按相册分组**：图库页标题行右侧的「全部 / 按相册」可以切换展示方式（有相册之后才出现）。「按相册」把工程按相册分成几组，相册的顺序与侧栏一致、没有工程的相册不出现，没放进相册的工程收在最后一组「未放入相册」；点相册名进入该相册。在组与组之间拖动卡片就是移动相册（拖到「未放入相册」一组是移出相册），组内拖动仍是排序。展示方式记在本机；相册页本身就是一个相册，没有这个切换。
- **排序**：图库页与相册页的标题行有「排序」菜单，可按最近修改（默认）、创建时间、名称或手动排序；手动排序时把卡片拖到另一张卡片的前后调整顺序，在别的排序方式下直接拖动，看到的顺序就成为手动顺序。排序方式记在本机。手动顺序整个图库共用一条，相册里是它的子序列；工程移进或移出相册、新导入的照片排在最前。
- **右键菜单**：工程卡片（移到相册、移出相册、删除）、侧栏相册（就地重命名、更换图标、删除）、图层（显示或隐藏、重命名、上移、下移、删除）和画布（撤销重做、切换工具、缩放）都可以右键操作。其余位置不弹出浏览器自带的「后退 / 刷新 / 打印」菜单，输入框里与选中文字时仍有剪切、复制、粘贴。

## 为什么不直接“读图 → 蒙版 → images/edits”

1. **GPT Image 的蒙版只是提示**：模型会重画整张输入图，蒙版外也可能变化。本项目的做法是只把蒙版附近区域裁出来送去编辑，结果回来后，在环带上做色彩统计匹配，再以羽化蒙版作为 alpha 贴回原图。
2. **编辑分辨率有上限**：任意尺寸要求宽高是 16 的倍数、比例 ≤ 3:1、最大 3840×2160。裁剪后再编辑，可以保留原图的全分辨率。
3. **调色交给本地处理**：参数化 GPU 管线无损、实时、零成本，调色参数可随时修改，不需要重新生成。

## 快速开始

```bash
pnpm install
pnpm dev
```

打开 http://localhost:3000。没有设置 API Key（或模型）时会弹出配置向导，按「欢迎 → 连接 AI 服务 → 选择模型」三步填写 OpenAI 兼容接口的 Base URL、API Key 和模型名，最后一步可以直接测试连接。应用的功能都依赖 AI，所以向导不能跳过或关闭，配好之前每次打开都会弹出。连接接口这一步推荐直接登录 PawBuddy 账户（见下文）。思考等级、修图质量等其余选项只在「设置」中：

| 用途 | 默认模型 | 说明 |
|---|---|---|
| 读图 | `gpt-6.1-sol` | 需要支持图像输入；测试连接时会自动检测结构化输出能力（json_schema → json_object → 纯提示词） |
| 修图 | `gpt-image-2.5-sunburst` | 旧模型或只支持固定尺寸的兼容服务，请把「尺寸模式」切换为固定尺寸 |

网页版由浏览器直接请求你配置的接口，只能连接允许浏览器跨域（CORS）的服务；不支持跨域的服务请用桌面版，桌面版的请求由 Rust 端发出，不受跨域限制。

### PawBuddy 账户

不想自己找接口时，可以在向导或设置页点「登录 PawBuddy」，用 [PawBuddy](https://pawbuddy.chat) 账户连接。读图与修图都走账户的网关，按量从账户余额扣费；设置页的账户一行可以打开充值页或断开连接。

1. 网页版整页跳到 PawBuddy 网站的 `/connect?app=ai-photo&return=<当前页面>`，桌面版在系统浏览器打开同一页面，`return` 是 `ai-photo-master://connect`
2. 网站上登录或注册，确认「授权并返回」。网站为本应用单独建一把 Key（名为「AI 修图」），与 PawBuddy 客户端互不影响
3. 网站跳回 `return`，连接码 `PB1.…` 放在地址的 `#code=` 里（不进服务器日志）。本应用解析出网关与 Key，写进读图的连接配置（修图沿用），并换上账户预设：读图模型 `deepseek-v4.1-flash`、思考等级 `max`，修图模型 `image-2.5-sunburst`
4. 网页版跳回后立即从地址栏去掉连接码；向导没走完时直接打开最后一步「准备就绪」，不再选模型

连着账户时预设的几项不能改，设置页与向导都不显示模型、思考等级和「沿用读图模型的连接配置」这几行；断开账户后它们回到默认并重新显示。

网站没有自动跳回时（例如浏览器拦截了深链），在网站上复制连接码，到本应用点「粘贴连接码」粘贴即可。PawBuddy 网站地址默认是 `https://pawbuddy.chat`，构建时可用环境变量 `NUXT_PUBLIC_PAWBUDDY_SITE` 改成别的部署（例如本机调试的 `http://localhost:3002`）。授权页的约定见 PawBuddy 网站仓库的 `app/utils/connect.ts`。

### 部署

```bash
pnpm generate   # 纯静态站点，产物在 .output/public，放到任意静态服务器即可
```

### 工程数据

工程保存在 IndexedDB 数据库 `ai-photo-master` 中（桌面版位于下文的 WebView2 数据目录），分四张表：

| 表 | 内容 |
|---|---|
| `projects` | 名称、尺寸、原图类型、缩略图等元数据，所属相册 `albumId`（不在相册中的工程没有这一项），桌面版的磁盘文件 `filePath`（没有记录时没有这一项；与 `albumId` 一样不建索引，不需要升级数据库版本），以及手动排序的位置 `order`（整数，越小越靠前；没有这一项的工程排在所有排过的工程之前，同样不建索引） |
| `docs` | 工程文档（图层、裁剪、读图结果、已采纳的建议）与最近修改时间，主键为工程 id |
| `blobs` | 原图与重绘补丁 |
| `albums` | 相册名称、创建时间与可选的 emoji 图标 `emoji`（不建索引，加入这一项不需要升级数据库版本） |

自动保存只写 `docs` 中的一行：发出一个写请求后立即提交事务，即使紧接着刷新或关闭页面，写入也能完成。把工程移入或移出相册只改 `projects` 中的 `albumId`（并清掉 `order`），拖动排序只批量改 `order`，两者都不改变工程的修改时间。

数据库升级在第一次打开时自动完成：

- 版本 1 → 2：旧版本的工程文档存在 `projects` 表中，迁移到 `docs` 表
- 版本 2 → 3：新增 `albums` 表与 `projects.albumId` 索引，已有工程不属于任何相册，内容不变

升级后，旧版本无法再打开这个数据库。如果需要回退，请先在新版本中导出要保留的照片，再清除本站数据（桌面版删除其数据目录）。

### Windows 桌面版

用 Tauri 2 打包，界面与网页版相同，运行在系统自带的 WebView2（Edge 内核）中。与网页版的区别：

- 请求由 Rust 端直接发出，不受跨域限制，网页版连不上的服务也能用
- 导入照片用系统「打开」对话框，工程会记下原图在磁盘上的位置（`projects.filePath`）。拖入的照片和旧工程没有这个位置
- 顶栏的主按钮是「保存」（Ctrl+S 相同）：保存工程，并把结果**覆盖写回原图文件**，不弹任何对话框。格式跟着文件扩展名走（JPEG 原图保留 EXIF），每次都从工程里保留的未修改原图重新渲染，反复保存不会累积压缩损失。没有记录位置时先弹「另存为」选一次，选定的位置从此作为这张照片的文件；记着的位置写不进去（文件夹被移走、文件被占用）时也会请你另选位置。要另存一份、换格式、调质量，用旁边菜单里的「导出…」（网页版没有磁盘上的原图，主按钮就是「导出」，文件由浏览器下载）
- 选过的文件路径由 `tauri-plugin-persisted-scope` 记在 `%APPDATA%\com.k99k5.ai-photo-master\.persisted-scope`，重启后「保存」仍有权限写回
- 关闭窗口时先写入还没保存的修改再关闭，最多等 5 秒；保存失败或超时会弹出对话框，可以放弃修改关闭，也可以返回编辑
- 工程数据保存在 `%LOCALAPPDATA%\com.k99k5.ai-photo-master\EBWebView`，与浏览器中的网页版互不相通
- 登录 PawBuddy 时在系统浏览器打开网站，授权后经 `ai-photo-master://` 深链回到已打开的窗口（只运行一个实例，再次启动会把已有窗口带到前台）。安装包在安装时注册这个深链，`pnpm tauri dev` 运行时自动注册

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

### 部署与发布

网页版部署在 Cloudflare Pages（Git 集成构建）；桌面版安装包由 GitHub Actions **只在推送 `v*` 标签时**编译，并随网页一起提供下载，普通提交不会触发编译。

**Cloudflare Pages（一次性配置）**

| 项 | 值 |
|---|---|
| 框架预设 | 无 |
| 构建命令 | `pnpm build:pages` |
| 输出目录 | `.output/public` |
| 环境变量 | `PNPM_VERSION` = `10.6.3`（Node 版本读取根目录的 `.node-version`） |
| 生产分支 | `main` |

`pnpm build:pages` 先 `nuxt generate`，再执行 `scripts/release.ts fetch`：从仓库最新 Release 下载安装包和 `latest.json`，校验大小与 sha256 后放进站点的 `/download/`。还没有任何 Release 时跳过；已有 Release 但下载或校验失败时构建失败，线上保持上一次的版本（Pages 整站原子替换，放过去会让下载入口消失）。

**发布桌面版（只有这一步会编译 exe）**

一次性配置：在 Pages 项目的 Settings > Builds 添加 Deploy hook（分支选 `main`），把得到的 URL 存进 GitHub 仓库的 Secrets，名称 `PAGES_DEPLOY_HOOK`。不配置也能发布，但 Release 建好后要手动重新部署一次 Pages，站点才会带上新安装包。

```bash
npm version 0.2.0 -m "release %s"   # 修改 package.json 的版本、提交、打标签 v0.2.0
git push --follow-tags              # 标签推上去后 Actions 开始编译
```

首次发布 0.1.0 时 `package.json` 已经是 0.1.0，`npm version` 不会重复升同一个版本，直接打标签：`git tag v0.1.0 && git push origin v0.1.0`。

工作流 `.github/workflows/release.yml` 依次：校验标签与 `package.json` 版本一致、跑单元测试、`pnpm tauri build`、把安装包整理成固定文件名 `ai-photo-master-setup.exe` 并生成 `latest.json`（版本、大小、sha256）、创建 Release、触发 Pages 重新构建。完成后站点提供 `/download/ai-photo-master-setup.exe` 与 `/download/latest.json`。

- 版本号带 `-` 的（如 `0.2.0-beta.1`）按预发布处理：不会成为 `latest`，也不会触发 Pages 重新构建
- 版本号只维护在 `package.json`：`tauri.conf.json` 的 `version` 引用它，`Cargo.toml` 里的 `version` 不参与发布，不用改
- 某次发布失败要重来：删掉 Release 和远程、本地标签（`gh release delete v0.2.0 --cleanup-tag && git tag -d v0.2.0`），修好后重新打标签

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
| 右键 | 打开工程卡片、侧栏相册、图层或画布的操作菜单 |
| 拖动工程卡片 | 放到侧栏的相册上移进该相册，放到「图库」上移出相册；在网格里放到另一张卡片的前后调整顺序；「按相册」视图里放到另一组的网格上移进那个相册 |
| 单击照片外的空白处 | 取消选中图层（选择工具下；拖动是平移画布） |

## 目录结构

```
app/
  lib/            纯逻辑（不依赖 Nuxt，可在主线程、Worker、node 测试中复用）
    pipeline/     WebGL2 调色管线（着色器、渲染器、图层构建）
    mask/         区域模型与栅格化
    inpaint/      重绘尺寸规划、色彩匹配、补丁合成、Worker 收尾
    llm/          OpenAI 兼容客户端、流式读图分析（含降级与进度草稿）、images/edits、错误说明
    geometry/     裁剪与旋转几何
    image/        画布工具、底图合成、EXIF、分块导出
    storage/      IndexedDB（Dexie）
    project/      工程文档模型、退出前补存
    library/      图库里工程的排列规则（自动排序与手动排序的位置分配、按相册分组）
    pawbuddy.ts   PawBuddy 连接码、授权页地址与账户预设
  stores/         Pinia：设置（含 PawBuddy 账户）、图库与相册、编辑会话（撤销/自动保存）、读图、重绘任务
  plugins/        Konva 注册；页面卸载与窗口关闭前补存；拦截浏览器自带的右键菜单；接收 PawBuddy 授权带回的连接码
  composables/    预览渲染、资源缓存、Worker、导出、提示、相册操作（侧栏右键与相册页共用）、工程卡片拖放（网格与侧栏共用）、测试连接（设置页与配置向导共用）、PawBuddy 登录与连接
  components/     编辑器界面（画布、图层、区域工具、参数、建议、重绘、裁剪、导出）、工程网格、侧栏导航、设置项与首次配置向导
  workers/        图像计算 Worker（导出、重绘收尾）
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

wry 总是显式设置 WebView2 启动参数，`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量不生效，所以调试端口只能写进合并配置。`tauri.desktop-test.conf.json` 会整体替换窗口配置，测试开始时会校验它除调试参数外与 `tauri.conf.json` 一致。WebView2 数据目录指向临时文件夹，不影响本机已安装应用的工程数据（debug 版仍会在 `%LOCALAPPDATA%\com.k99k5.ai-photo-master` 下写入空的日志与 cookie 文件）。模拟接口不返回任何 CORS 响应头，「打开」「另存为」对话框由 Windows UI 自动化操作。关窗用例在应用重绘结果后、自动保存的防抖到期前向主窗口投递 `WM_CLOSE`（与点标题栏关闭按钮相同），再以同一数据目录重启，确认修改已经写入；「保存」用例还会重启一次，确认对话框授予的文件权限由 persisted-scope 恢复（它写在 `%APPDATA%\com.k99k5.ai-photo-master\.persisted-scope`，测试选的是临时文件夹里的路径，不影响已安装应用的使用）。**已安装应用或 `pnpm tauri dev` 正在运行时测试窗口会被转交给它（单实例），需要先关掉它们。**
