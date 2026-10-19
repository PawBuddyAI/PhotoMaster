# AI 修图

纯前端的 AI 修图工具：多模态 LLM 读图给出修图方案，曝光、白平衡等调色在本地 GPU 上无损完成（可限定区域），去路人、换天空等内容修改通过 OpenAI 兼容的 `images/edits` 局部重绘。

基于 Nuxt 4 + Nuxt UI v4，以 SPA 方式运行，不需要自建后端。

## 功能

- **AI 读图建议**：读图模型返回三类建议——参数化调色（全图或局部区域）、生成式重绘、构图裁剪。每条建议都可以一键采纳为图层，再继续微调。
- **区域调色图层**：曝光、对比度、高光、阴影、黑白色阶、色温、色调、自然饱和度、饱和度、清晰度、锐化。每个图层可以限定区域：全图、矩形、椭圆（羽化）、线性渐变，或仅由画笔决定；支持画笔添加和擦除、反转、强度。
- **局部重绘**：用矩形、椭圆或画笔圈出区域，并填写指令；每次生成多张候选供挑选。结果只替换蒙版内的像素，蒙版外与原图逐位一致。
- **裁剪与水平校正**：旋转后裁剪框自动收缩到无空白角的最大区域，支持多种长宽比。
- **非破坏式编辑**：图层可以开关、排序、删除，支持撤销和重做，工程自动保存在浏览器（IndexedDB）中。
- **全分辨率导出**：在 Worker 中分块渲染，导出尺寸为原图尺寸，支持 JPEG / PNG / WebP；JPEG 原图可保留 EXIF。

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
  stores/         Pinia：设置、编辑会话（撤销/自动保存）、读图、重绘任务
  composables/    预览渲染、资源缓存、Worker、导出、提示
  components/     编辑器界面（画布、图层、区域工具、参数、建议、重绘、裁剪、导出）
  workers/        图像计算 Worker（导出、重绘收尾）
server/api/proxy  可选的 CORS 代理
shared/           前端与服务端共享的常量
tests/unit        Vitest 单元测试
tests/e2e         Playwright 浏览器测试
```

## 测试

```bash
pnpm test        # 单元测试（node 环境）
pnpm test:e2e    # 浏览器测试：WebGL 管线 + 端到端流程（接口由 page.route 模拟）
pnpm lint
pnpm typecheck
```

浏览器测试默认使用本机 Edge。其他环境可以先执行 `pnpm exec playwright install chromium`，再设置 `PW_CHANNEL=chromium` 运行。测试默认复用（或自动启动）3210 端口的开发服务器，可通过 `PW_PORT` 修改。
