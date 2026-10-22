# AI修图大师

让 AI 先看懂你的照片该怎么修，再由你决定改哪里、改多少。

打开照片，AI 读图后给出一份修图方案：调色、去路人换天空、重新构图。每一条建议都能一键变成可以继续调整的图层，不满意就关掉、改小，或者回到原图对比。最后按原图的完整分辨率导出。

- **网页版**：在浏览器里直接使用，不用安装。工程保存在你自己的电脑上，只有用到 AI 功能时，照片才会发给你连接的 AI 服务。
- **Windows 桌面版**：装在电脑上，修完一键存回原来的照片。安装包在 [GitHub Releases](https://github.com/PawBuddyAI/PhotoMaster/releases) 下载，网页版的向导、侧栏和设置页里也有入口。

基于 Nuxt 4 + Nuxt UI v4，以纯前端 SPA 运行，没有自建后端；桌面版用 Tauri 2 打包同一套界面。

## 功能

### RAW 导入

- 网页版和桌面版使用本地 LibRaw WASM 解码，可选择 DNG、ARW、CR2 / CR3、NEF、RAF 等 RAW 文件；具体机型和压缩方式的兼容性由解码器决定。
- 按拍摄白平衡和方向生成完整尺寸的 **8 位 sRGB PNG 编辑副本**，供现有 AI 分析、调色和重绘使用。这一阶段不提供高位深 RAW 调色或 RAW 导出，输出不携带 RAW 的 EXIF。
- RAW 原文件、来源文件名、解码版本与参数保存在工程中；重开工程直接读取 PNG，不重复解码。删除工程时原件和副本一起从本机工程存储删除。
- 桌面版不会覆盖磁盘上的 RAW 原件，第一次「保存」需要另选输出位置。
- 解码在 Worker 中进行，可取消；当前上限为单张 200 MB、6000 万像素，解码超时为 120 秒。不兼容的文件可先转换为 PNG / JPEG 再导入。
- 解码器来源与第三方许可见 [RAW NOTICE](public/third-party/raw/NOTICE.txt)，随网页和桌面静态资源一同分发。

### AI 读图与建议

- 读图后给出三类建议：**参数化调色**（全图或局部）、**生成式重绘**、**构图裁剪**。每条建议可一键采纳为图层，再继续微调。
- 分析过程流式显示：实时展示模型的思考过程（服务返回 `reasoning_content` / `reasoning` 或 `<think>` 标签时），以及正在写出的总评和建议标题，不显示原始 JSON。
- 结构化输出自动降级（`json_schema` → `json_object` → 纯提示词），测试连接时就会检测。

### 编辑

- **区域调色图层**：曝光、对比度、高光、阴影、黑白色阶、色温、色调、自然饱和度、饱和度、清晰度、锐化。每个图层可限定区域——全图、矩形、椭圆（可羽化）、线性渐变，或只由画笔决定；支持画笔添加与擦除、反转、调节强度。
- **局部重绘**：用矩形、椭圆或画笔圈出区域并写下指令，每次生成多张候选供挑选。结果只替换蒙版内的像素，蒙版外与原图逐位一致。
- **裁剪与水平校正**：旋转后裁剪框自动收缩到没有空白角的最大区域，支持多种长宽比。
- **非破坏式**：图层可开关、排序、删除，支持撤销与重做，随时按住 `\` 对比原图。
- **自动保存**：工程存在浏览器的 IndexedDB 里。修改停顿 0.6 秒后写入，页面切到后台、刷新或关闭时立即补存；关闭时若仍有修改没写完，浏览器会先请求确认。

### 导出

在 Worker 中分块渲染，导出尺寸与原图一致，支持 JPEG / PNG / WebP；JPEG 原图可保留 EXIF。

### 图库与相册

- 图库列出全部工程，相册用来分组整理，结构与 macOS「照片」相同。一个工程最多属于一个相册，删除相册不会删除其中的工程。
- 相册可选一个 emoji 作图标，不选时显示相册里最近修改的那张照片。在相册里导入的照片直接放进该相册。
- 把卡片拖到侧栏的相册上就移进去，拖到「图库」上就移出；也可以用卡片的「更多操作」或右键菜单。
- 图库页标题行的「全部 / 按相册」切换展示方式（有相册之后才出现）：「按相册」按侧栏顺序分组，没放进相册的工程收在最后的「未放入相册」，在组与组之间拖动卡片就是移动相册。
- 「排序」菜单支持最近修改（默认）、创建时间、名称和手动排序。手动顺序整个图库共用一条，相册里是它的子序列；移进或移出相册、新导入的照片排在最前。展示方式与排序方式都记在本机。
- 右键菜单覆盖工程卡片、侧栏相册、图层和画布，其余位置不弹出浏览器自带的「后退 / 刷新 / 打印」菜单；输入框和选中文字时仍有剪切、复制、粘贴。

## 为什么不直接「读图 → 蒙版 → images/edits」

1. **蒙版只是提示**：GPT Image 会重画整张输入图，蒙版外也可能变化。本项目只把蒙版附近的区域裁出来送去编辑，结果回来后在环带上做色彩统计匹配，再以羽化蒙版作为 alpha 贴回原图。
2. **编辑分辨率有上限**：任意尺寸要求宽高是 16 的倍数、比例 ≤ 3:1、最大 3840×2160。裁剪后再编辑，原图的全分辨率得以保留。
3. **调色交给本地**：参数化 GPU 管线无损、实时、零成本，参数随时可改，不必重新生成。

## 开始使用

### 连接 AI

应用的功能都依赖 AI，所以没有配好读图的 API Key 或模型时，每次打开都会弹出配置向导，配好之前关不掉、也不能跳过。向导分三步：欢迎 → 连接 AI → 选择模型；最后一步可以直接测试连接。思考等级、修图质量等其余选项只在「设置」里。

有两种连接方式：

**PawBuddy 账户（推荐）**：在向导或设置页点「登录 PawBuddy」，用 [PawBuddy](https://pawbuddy.chat) 账户连接。读图和修图都走账户的网关，按量从账户余额扣费；设置页的账户一行可以打开充值页或断开连接。

**自己的 OpenAI 兼容接口**：填写 Base URL、API Key 和模型名。

| 用途 | 默认模型 | 说明 |
|---|---|---|
| 读图 | `gpt-6.1-sol` | 需要支持图像输入 |
| 修图 | `gpt-image-2.5-sunburst` | 旧模型或只支持固定尺寸的兼容服务，把「尺寸模式」切换为固定尺寸 |

### 网页版与桌面版

| | 网页版 | Windows 桌面版 |
|---|---|---|
| 运行环境 | 浏览器 | Windows 自带的 WebView2（Edge 内核） |
| 发出请求 | 浏览器直接请求，目标服务需允许跨域（CORS） | 由 Rust 端发出，不受跨域限制 |
| 导入照片 | 浏览器选择或拖入 | 系统「打开」对话框，工程会记下原图在磁盘上的位置 |
| 顶栏主按钮 | 「导出」，文件由浏览器下载 | 「保存」，见下 |
| 工程数据 | 浏览器 IndexedDB | WebView2 数据目录，与浏览器里的网页版互不相通 |

桌面版的「保存」（`Ctrl+S` 相同）保存工程，并把结果**覆盖写回原图文件**，不弹对话框：

- 格式跟着文件扩展名走（JPEG 原图保留 EXIF），每次都从工程里保留的未修改原图重新渲染，反复保存不会累积压缩损失。
- RAW 导入保留原文件，首次保存编辑结果时另选 PNG / JPEG / WebP 位置，不写回 RAW。
- 没有记录位置（拖入的照片、旧工程）时先弹「另存为」选一次，选定的位置从此作为这张照片的文件；记着的位置写不进去（文件夹被移走、文件被占用）时也会请你另选。
- 要另存一份、换格式、调质量，用旁边菜单里的「导出…」。
- 选过的路径由 `tauri-plugin-persisted-scope` 记在 `%APPDATA%\com.k99k5.ai-photo-master\.persisted-scope`，重启后仍有权限写回。
- 关闭窗口时先写入还没保存的修改，最多等 5 秒；保存失败或超时会弹出对话框，可以放弃修改关闭，也可以返回编辑。
- 只运行一个实例，再次启动会把已有窗口带到前台。

安装包按当前用户安装，不需要管理员权限，未签名，首次运行会出现 SmartScreen 提示。工程数据在 `%LOCALAPPDATA%\com.k99k5.ai-photo-master\EBWebView`。

### 快捷键

| 按键 | 作用 |
|---|---|
| `V` / `B` / `E` / `C` | 选择、画笔添加、画笔擦除、裁剪 |
| `Esc` | 回到选择工具 |
| `[` / `]` | 缩小、放大笔刷 |
| 按住 `\` | 对比原图 |
| `Space` + 拖动 / 鼠标中键 | 平移画布 |
| 滚轮 | 以指针为中心缩放 |
| `0` | 适应窗口 |
| `Ctrl+Z` / `Ctrl+Shift+Z`（或 `Ctrl+Y`） | 撤销、重做 |
| `Ctrl+S` | 桌面版保存；网页版立即写入工程 |
| 右键 | 工程卡片、侧栏相册、图层、画布的操作菜单 |
| 单击照片外的空白处 | 取消选中图层（选择工具下；拖动是平移画布） |

## 开发

### 环境

- Node.js 24（版本见 `.node-version`）与 pnpm 10.6.3（`packageManager` 已固定）
- 桌面版另需 Rust 1.90 以上与 Visual Studio C++ 生成工具

### 常用命令

```bash
pnpm install
pnpm dev            # 开发服务器，http://localhost:3000
pnpm generate       # 生成纯静态站点，产物在 .output/public，可放到任意静态服务器
pnpm lint
pnpm typecheck
pnpm tauri dev      # 桌面版开发：启动 3000 端口的开发服务器并打开桌面窗口
pnpm tauri build    # 打包桌面版：src-tauri/target/release/bundle/nsis/ 下生成安装包
```

- Tauri 启动的开发服务器与打包使用独立的构建目录（`node_modules/.cache/nuxt-tauri`），另一个 `pnpm dev` 运行时也能打包。
- 发布后不要修改 `src-tauri/tauri.conf.json` 中的 `identifier`：数据目录随之改变，已有工程会「消失」。
- 图标源文件是 `public/app-icon.svg`（启动画面也直接显示它）。修改后执行 `pnpm tauri icon public/app-icon.svg`，删除生成的 `android`、`ios` 目录，再把 `src-tauri/icons/icon.ico` 复制为 `public/favicon.ico`。
- 登录 PawBuddy 的网站地址默认是 `https://pawbuddy.chat`，构建时用环境变量 `NUXT_PUBLIC_PAWBUDDY_SITE` 可以改成别的部署（例如本机调试的 `http://localhost:3002`）。

### 目录结构

```
app/
  lib/            纯逻辑（不依赖 Nuxt，主线程、Worker、node 测试都能复用）
    pipeline/     WebGL2 调色管线（着色器、渲染器、图层构建）
    adjust/       调色参数定义
    mask/         区域模型与栅格化
    inpaint/      重绘尺寸规划、色彩匹配、补丁合成、Worker 收尾
    llm/          OpenAI 兼容客户端、流式读图分析（含降级与进度草稿）、images/edits、错误说明
    geometry/     裁剪与旋转几何
    image/        画布工具、底图合成、EXIF、分块导出
    storage/      IndexedDB（Dexie）
    project/      工程文档模型、退出前补存
    library/      图库排列规则（自动排序与手动排序的位置分配、按相册分组）
    pawbuddy.ts   PawBuddy 连接码、授权页地址与账户预设
    release.ts    桌面版发布清单（latest.json）的格式与读取，发布脚本与网页版下载入口共用
  stores/         Pinia：设置（含 PawBuddy 账户）、图库与相册、编辑会话（撤销、自动保存）、读图、重绘任务
  plugins/        Konva 注册；页面卸载与窗口关闭前补存；拦截浏览器自带右键菜单；接收 PawBuddy 授权带回的连接码
  composables/    预览渲染、资源缓存、Worker、导出、提示、相册操作、工程卡片拖放、测试连接、PawBuddy 登录、桌面版下载入口
  components/     editor（画布、图层、参数、建议、重绘、裁剪、导出）、library、settings（含首次配置向导）、shell
  workers/        图像计算 Worker（导出、重绘收尾）
scripts/          桌面版发布清单的打包与拉取（release.ts）
src-tauri/        Windows 桌面壳（窗口与打包配置、插件权限、图标）
tests/unit        Vitest 单元测试
tests/e2e         Playwright 浏览器测试
tests/desktop     桌面版端到端测试
```

### 工程数据

工程保存在 IndexedDB 数据库 `ai-photo-master` 中，分四张表：

| 表 | 内容 |
|---|---|
| `projects` | 名称、尺寸、原图类型、缩略图等元数据；所属相册 `albumId`、桌面版的磁盘文件 `filePath`、手动排序位置 `order`（整数，越小越靠前）。这三项没有值时不写入，也都不建索引，增减它们不需要升级数据库版本 |
| `docs` | 工程文档（图层、裁剪、读图结果、已采纳的建议）与最近修改时间，主键为工程 id |
| `blobs` | 原图与重绘补丁 |
| `albums` | 相册名称、创建时间与可选的 emoji 图标 `emoji`（同样不建索引） |

- 自动保存只写 `docs` 中的一行：发出写请求后立即提交事务，即使紧接着刷新或关闭页面，写入也能完成。
- 把工程移入或移出相册只改 `albumId`（并清掉 `order`），拖动排序只批量改 `order`，两者都不改变工程的修改时间。
- 数据库在第一次打开时自动升级：版本 1 → 2 把旧版本存在 `projects` 表里的工程文档迁到 `docs` 表；版本 2 → 3 新增 `albums` 表与 `projects.albumId` 索引，已有工程不属于任何相册，内容不变。
- 升级后旧版本无法再打开这个数据库。需要回退时，先在新版本中导出要保留的照片，再清除本站数据（桌面版删除其数据目录）。

### PawBuddy 授权流程

1. 网页版整页跳到 PawBuddy 网站的 `/connect?app=ai-photo&return=<当前页面>`；桌面版在系统浏览器打开同一页面，`return` 是 `ai-photo-master://connect`（深链由安装包注册，`pnpm tauri dev` 时自动注册）。
2. 在网站上登录或注册，确认「授权并返回」。网站为本应用单独建一把名为「AI 修图」的 Key，与 PawBuddy 客户端互不影响。
3. 网站跳回 `return`，连接码 `PB1.…` 放在地址的 `#code=` 里（不进服务器日志）。应用解析出网关与 Key，写进读图的连接配置（修图沿用），并换上账户预设：读图模型 `deepseek-v4.1-flash`、思考等级 `max`，修图模型 `image-2.5-sunburst`。
4. 网页版跳回后立即从地址栏去掉连接码；向导没走完时直接打开最后一步「准备就绪」。

连着账户时预设的几项不能改，设置页与向导都不显示模型、思考等级和「沿用读图模型的连接配置」这几行；断开账户后恢复默认并重新显示。网站没有自动跳回时（例如浏览器拦截了深链），在网站上复制连接码，到本应用点「粘贴连接码」即可。授权页的约定见 PawBuddy 网站仓库的 `app/utils/connect.ts`。

## 测试

```bash
pnpm test        # Vitest 单元测试（node 环境）
pnpm test:e2e    # Playwright 浏览器测试：WebGL 管线 + 端到端流程（接口由 page.route 模拟）
```

浏览器测试默认使用本机 Edge。其他环境先执行 `pnpm exec playwright install chromium`，再设置 `PW_CHANNEL=chromium` 运行。测试默认复用（或自动启动）3210 端口的开发服务器，可用 `PW_PORT` 修改。

**桌面版测试**连接真实的桌面窗口，需要先构建一个开启了 WebView2 远程调试端口（9333）的 debug 版本，输出到 `src-tauri/target/debug/`，不影响发布版与安装包：

```bash
pnpm tauri build --debug --no-bundle --config src-tauri/tauri.desktop-test.conf.json
pnpm exec playwright test -c playwright.desktop.config.ts
```

- 已安装的应用或 `pnpm tauri dev` 正在运行时，测试窗口会被转交给它们（单实例），**需要先关掉**。
- wry 总是显式设置 WebView2 启动参数，环境变量 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 不生效，所以调试端口只能写进合并配置。`tauri.desktop-test.conf.json` 会整体替换窗口配置，测试开始时会校验它除调试参数外与 `tauri.conf.json` 一致。
- WebView2 数据目录指向临时文件夹，不影响本机已安装应用的工程数据；「保存」用例选的也是临时文件夹里的路径。
- 模拟接口不返回任何 CORS 响应头；「打开」「另存为」对话框由 Windows UI 自动化操作。
- 关窗用例在重绘结果出现后、自动保存的防抖到期前向主窗口投递 `WM_CLOSE`（与点标题栏关闭按钮相同），再以同一数据目录重启，确认修改已经写入；「保存」用例还会重启一次，确认文件权限由 persisted-scope 恢复。

## 部署与发布

网页版部署在 Cloudflare Pages（Git 集成构建）。桌面版安装包由 GitHub Actions **只在推送 `v*` 标签时**编译，并随网页一起提供下载，普通提交不会触发编译。

### 网页版（Cloudflare Pages，一次性配置）

| 项 | 值 |
|---|---|
| 框架预设 | 无 |
| 构建命令 | `pnpm build:pages` |
| 输出目录 | `dist` |
| 环境变量 | `PNPM_VERSION` = `10.6.3`（Node 版本读取根目录的 `.node-version`） |
| 生产分支 | `main` |

Pages 构建环境下 Nuxt 自动选用 `cloudflare-pages-static` 预设，产物在 `dist/`（本机与 GitHub Actions 仍是 `.output/public`），所以输出目录必须填 `dist`，填 `.output/public` 的话站点里只剩 `/download/`。

`pnpm build:pages` 先 `nuxt generate`，再执行 `scripts/release.ts fetch`：从仓库最新 Release 下载安装包和 `latest.json`，校验大小与 sha256 后放进站点的 `/download/`。

- 还没有任何 Release 时跳过，站点不显示下载入口。
- 已有 Release 但下载或校验失败时构建失败，线上保持上一次的版本（Pages 整站原子替换，放过去会让下载入口消失）。

### 网页版里的下载入口

网页版启动时读取同源的 `/download/latest.json`，读到合法清单才出现入口，共四处：首次配置向导的欢迎页、侧栏底部的「下载桌面版」、设置页的「桌面版」分组，以及连不上服务时错误提示里的「下载桌面版」按钮。桌面版自己不请求也不展示。清单格式与文件名见 `app/lib/release.ts`，发布脚本与网页版共用。

### 发布桌面版（只有这一步会编译）

一次性配置（可选）：在 Pages 项目的 Settings > Builds 添加 Deploy hook（分支选 `main`），把得到的 URL 存进 GitHub 仓库 Secrets，名称 `PAGES_DEPLOY_HOOK`。不配置也能发布，但 Release 建好后要手动重新部署一次 Pages，站点才会带上新安装包。

```bash
npm version 0.2.0 -m "release %s"   # 修改 package.json 的版本、提交、打标签 v0.2.0
git push --follow-tags              # 标签推上去后 Actions 开始编译
```

首次发布 0.1.0 时 `package.json` 已经是 0.1.0，`npm version` 不会重复升同一个版本，直接打标签：`git tag v0.1.0 && git push origin v0.1.0`。

工作流 `.github/workflows/release.yml` 依次：校验标签与 `package.json` 版本一致 → 跑单元测试 → `pnpm tauri build` → 把安装包整理成固定文件名 `ai-photo-master-setup.exe` 并生成 `latest.json`（版本、大小、sha256）→ 创建 Release → 触发 Pages 重新构建。完成后站点提供 `/download/ai-photo-master-setup.exe` 与 `/download/latest.json`。

- 版本号带 `-` 的（如 `0.2.0-beta.1`）按预发布处理：不会成为 `latest`，也不会触发 Pages 重新构建。
- 版本号只维护在 `package.json`：`tauri.conf.json` 的 `version` 引用它，`Cargo.toml` 里的 `version` 不参与发布，不用改。
- 某次发布失败要重来：先删掉 Release 和远程、本地标签（`gh release delete v0.2.0 --cleanup-tag && git tag -d v0.2.0`），修好后重新打标签。

## 许可证

本项目以 [Apache License 2.0](LICENSE) 开源。

## 友情链接

- [LINUX DO](https://linux.do/)
