---
name: AI修图大师
description: macOS 毛玻璃（Vibrancy）风格的桌面修图工作台，照片的色调透过侧栏，界面其余部分退到照片后面
colors:
  system-blue: "#0a84ff"
  system-blue-light: "#007aff"
  graphite-deep: "#1c1c1e"
  graphite-mid: "#2c2c2e"
  graphite-raised: "#3a3a3c"
  mist-deep: "#e5e5ea"
  mist-mid: "#f2f2f7"
  mist-raised: "#ffffff"
  ink-dark: "rgb(255 255 255 / 0.85)"
  ink-dark-highlighted: "rgb(255 255 255 / 0.95)"
  ink-dark-muted: "rgb(255 255 255 / 0.7)"
  ink-dark-dimmed: "rgb(255 255 255 / 0.55)"
  hairline-dark: "rgb(255 255 255 / 0.1)"
  hover-dark: "rgb(255 255 255 / 0.08)"
  selected-dark: "rgb(255 255 255 / 0.1)"
  track-dark: "rgb(255 255 255 / 0.12)"
  ink-light: "rgb(0 0 0 / 0.85)"
  ink-light-highlighted: "rgb(0 0 0 / 0.9)"
  ink-light-muted: "rgb(0 0 0 / 0.65)"
  ink-light-dimmed: "rgb(0 0 0 / 0.58)"
  hairline-light: "rgb(0 0 0 / 0.1)"
  hover-light: "rgb(0 0 0 / 0.05)"
  selected-light: "rgb(0 0 0 / 0.08)"
  track-light: "rgb(0 0 0 / 0.1)"
  success-green: "#30d158"
  success-green-light: "#1e7b34"
  warning-orange: "#ff9f0a"
  warning-orange-light: "#b25000"
  error-red: "#ff453a"
  error-red-light: "#d70015"
  info-blue: "#409cff"
  info-blue-light: "#0066cc"
  region-hover-yellow: "#ffd60a"
typography:
  headline:
    fontFamily: "'Noto Sans SC', 'Source Han Sans SC', 'Source Han Sans CN', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.35
  title:
    fontFamily: "'Noto Sans SC', 'Source Han Sans SC', 'Source Han Sans CN', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "'Noto Sans SC', 'Source Han Sans SC', 'Source Han Sans CN', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  body-strong:
    fontFamily: "'Noto Sans SC', 'Source Han Sans SC', 'Source Han Sans CN', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
  label:
    fontFamily: "'Noto Sans SC', 'Source Han Sans SC', 'Source Han Sans CN', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  mono:
    fontFamily: "'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.625
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
spacing:
  "0.5": "2px"
  "1": "4px"
  "1.5": "6px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "8": "32px"
  "10": "40px"
components:
  button-dialog-confirm:
    backgroundColor: "{colors.system-blue}"
    textColor: "{colors.mist-raised}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
    height: "36px"
  button-dialog-confirm-light:
    backgroundColor: "{colors.system-blue-light}"
    textColor: "{colors.mist-raised}"
  button-raised:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.ink-dark-highlighted}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
    height: "36px"
  button-raised-hover:
    backgroundColor: "color-mix(in srgb, #3a3a3c, white 8%)"
  button-raised-light:
    backgroundColor: "{colors.mist-raised}"
    textColor: "{colors.ink-light-highlighted}"
  button-raised-light-hover:
    backgroundColor: "color-mix(in srgb, #ffffff, black 4%)"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink-dark-muted}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
    height: "36px"
  button-outline-hover:
    backgroundColor: "{colors.hover-dark}"
    textColor: "{colors.ink-dark-highlighted}"
  button-tool:
    backgroundColor: "transparent"
    textColor: "{colors.ink-dark-muted}"
    rounded: "{rounded.lg}"
    size: "36px"
  button-tool-selected:
    backgroundColor: "{colors.selected-dark}"
    textColor: "{colors.system-blue}"
  input-field:
    backgroundColor: "{colors.graphite-deep}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.lg}"
    padding: "6px 10px"
    height: "32px"
  input-field-light:
    backgroundColor: "{colors.mist-raised}"
    textColor: "{colors.ink-light}"
  segmented-control:
    backgroundColor: "transparent"
    rounded: "{rounded.lg}"
    padding: "2px"
  segmented-control-selected:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.ink-dark-highlighted}"
    rounded: "{rounded.md}"
  vibrancy-sidebar:
    backgroundColor: "color-mix(in oklab, #1c1c1e 80%, transparent)"
    textColor: "{colors.ink-dark-muted}"
    width: "21rem"
  vibrancy-sidebar-light:
    backgroundColor: "color-mix(in oklab, #e5e5ea 80%, transparent)"
    textColor: "{colors.ink-light-muted}"
  nav-item-active:
    backgroundColor: "{colors.selected-dark}"
    textColor: "{colors.ink-dark-highlighted}"
    rounded: "{rounded.lg}"
    padding: "6px 10px"
  group-card:
    backgroundColor: "{colors.graphite-mid}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.xl}"
    padding: "12px"
  group-card-hover:
    backgroundColor: "color-mix(in srgb, #2c2c2e, white 5%)"
  group-card-light:
    backgroundColor: "{colors.mist-mid}"
    textColor: "{colors.ink-light}"
  settings-row:
    typography: "{typography.body}"
    padding: "12px 16px"
  status-tag-adopted:
    textColor: "{colors.ink-dark-muted}"
    typography: "{typography.body}"
    height: "36px"
  prompt-block:
    backgroundColor: "{colors.graphite-deep}"
    textColor: "{colors.ink-dark-muted}"
    typography: "{typography.mono}"
    rounded: "{rounded.lg}"
    padding: "6px 8px"
  canvas-well:
    backgroundColor: "{colors.graphite-deep}"
  inspector-panel:
    backgroundColor: "{colors.graphite-mid}"
    width: "19rem"
  switch-track:
    backgroundColor: "{colors.track-dark}"
    rounded: "{rounded.xl}"
    width: "36px"
    height: "20px"
  switch-track-on:
    backgroundColor: "{colors.system-blue}"
  slider-fill:
    backgroundColor: "{colors.system-blue}"
    rounded: "{rounded.xl}"
    height: "7px"
  tooltip:
    backgroundColor: "{colors.graphite-mid}"
    textColor: "{colors.ink-dark-highlighted}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
  overlay-menu:
    backgroundColor: "color-mix(in oklab, #2c2c2e 85%, transparent)"
    rounded: "{rounded.lg}"
---

# Design System: AI修图大师

## Overview

**Creative North Star: "照片即壁纸"**

这扇窗口的壁纸就是用户正在修的那张照片。macOS 的侧栏会透出桌面，这里的毛玻璃侧栏透出当前照片放大模糊后的色调：每个工程的侧栏颜色都不一样，用户进入编辑器的第一眼就知道这是「这张照片的工作台」。除了这一处透色，界面的其余部分只用三档深灰（亮色为三档浅灰）和 1px 发丝线分层，安静地退到照片后面。产品原则「照片优先」在视觉上的含义是：界面颜色不得干扰用户对照片色彩的判断。

整体密度属于专业桌面工具：编辑器是三栏工作台，长时间停留；控件紧凑、对齐严格，信息靠字号、字重和三档背景区分层级，不靠色块和装饰。标题、正文、标签和控件全部用思源黑体，中文与拉丁字形同出一源，跨平台观感一致；提示词和模型名用等宽字体。动效只解释反馈、状态与连续性，用 macOS 原生的分寸：一条指数减速曲线、离场比入场快；唯一一处编排是打开照片时，画布上的照片像镜头合焦一样清晰起来，侧栏同时溶解成这张照片的色调。

明确拒绝的方向：AI 工具的品类默认，即紫色主色、渐变按钮、发光效果和营销式的卡片堆叠。强调色系统蓝只标记交互状态，除弹窗确认按钮外从不铺成按钮或面板的底色。亮色与暗色是同一套语法的两种外观，必须同时提供并保留切换。

**Key Characteristics:**
- 照片着色的毛玻璃侧栏是唯一的大面积透明材质，也是招牌交互。
- 深度只来自三档背景（deep → mid → surface）和 1px 发丝线，静止的表面没有阴影。
- 系统蓝只出现在焦点环、选中工具、滑块填充、开关开启、选中候选框和弹窗确认按钮上。
- 一套思源黑体覆盖全部界面文字，层级只靠字号与字重，等宽字体只标机器读的文字。
- 动效只做反馈、状态和连续性；招牌时刻是照片合焦与侧栏色调溶解。用户要求减少动态效果时去掉位移、缩放和模糊，只留透明度与颜色。

## Colors

一套近乎无彩的系统灰阶，加上一个只用来标记状态的系统蓝；所有颜色都有亮、暗两个值，由 `.dark` 类切换。

### Primary
- **系统蓝**（system-blue / system-blue-light）：唯一的强调色。用于焦点环（2px、60% 不透明度；输入类为 3px、25% 的光圈）、选中工具的图标、侧栏导航激活项的图标、滑块的填充段、开关开启时的轨道、选中候选图的 1px 外框和勾号、文本选区（35% 混合）与输入光标，以及弹窗底部确认按钮的实心填充。暗色用 #0a84ff，亮色用 #007aff。

### Neutral
- **石墨凹槽**（graphite-deep，亮色对应 mist-deep）：最深的一档。用于画布凹槽、首页与设置页的内容区底、毛玻璃侧栏的基色、暗色下的输入框底、提示词代码块的底。
- **石墨面板**（graphite-mid，亮色对应 mist-mid）：中间一档。用于右侧属性检查器、编辑器的导航栏与工具条、建议卡片、设置分组、工程缩略图卡片、提示气泡、下拉菜单和弹窗。
- **石墨凸起**（graphite-raised，亮色对应 mist-raised）：最浅的一档。用于主按钮的凸起填充和分段控件的选中段；亮色下也是输入框的底。
- **墨色正文 / 高亮 / 弱化 / 次弱化**（ink-dark* 与 ink-light* 四档）：正文 85%，标题与选中项高亮（暗色 95%、亮色 90%），说明文字弱化（暗色 70%、亮色 65%），最弱一档（暗色 55%、亮色 58%）只用在不透明底上的保存状态、未改动的参数数值等次要信息。
- **发丝线**（hairline-dark / hairline-light）：所有分隔线、卡片外框、描边按钮的 1px 线，强度在 8%–12% 之间浮动（默认 10%，弱化 8%，强调 12%）。
- **悬停与选中**（hover-* / selected-*）：悬停时叠一层 8%（亮色 5%）的白（黑），选中项叠 10%（亮色 8%）。卡片悬停改用把面板色混入 5% 白（亮色 3% 黑）的实色，保持不透明。
- **轨道**（track-dark / track-light）：开关关闭时和滑块未填充部分的底色。

### 语义色
- **成功绿、警示橙、错误红、信息蓝**（success / warning / error / info，各有亮暗两值）：只落在文字和图标上，例如「已应用重绘结果」前的对勾、保存失败的文字、提示条左侧的图标。提示条、徽章和危险按钮的底色仍是中性灰。暗色下信息蓝取 #409cff 这一高对比版本，因为它会以小字出现在面板色上。

### 画布叠加色
- **区域悬停黄**（region-hover-yellow）：仅在画布上使用。鼠标悬停在建议卡片上时，用它勾出建议对应的区域；区域控制点用系统蓝描边、白色填充，画笔涂抹用 55% 不透明度的红（添加）和蓝（擦除）。这些颜色画在照片上，不随界面明暗切换。

### Named Rules
**「强调色只标状态」规则。** 系统蓝只回答「哪个被选中、哪里有焦点、哪个值被改过」。它从不做按钮、面板、徽章或提示条的底色；主按钮是凸起灰，不是蓝色。唯一的例外是弹窗底部的确认按钮：系统蓝实心填充、白字，像 macOS 弹窗里的默认按钮。

**「三档灰」规则。** 层级只能来自 deep、mid、surface 三档背景加 1px 发丝线。不新增第四档灰，不用渐变或彩色块制造层次。

**「玻璃上不放最弱文字」规则。** 毛玻璃侧栏的实际底色随照片变化。直接压在侧栏玻璃上的说明文字至少用弱化档（ink-*-muted），在纯白或纯黑照片下最低也有 5.18:1；最弱档在最坏情况下只有约 4:1，只能放在不透明底上。

## Typography

**Display / Body Font:** 思源黑体（Google Fonts 名称 Noto Sans SC；回退到本机的 Source Han Sans SC/CN、PingFang SC、Microsoft YaHei、sans-serif）
**Label/Mono Font:** SF Mono（回退到 Menlo、Consolas、Liberation Mono）

**Character:** 一套黑体贯穿标题与操作性文字，中文与拉丁字形同源、字面和灰度均匀，在 macOS 与 Windows 上看起来是同一个应用，而不是分别落到苹方和微软雅黑；名字与正文的区别交给字号和字重。等宽字体把提示词和模型名标成「机器读的文字」。

思源黑体由 `@nuxt/fonts` 从 Google Fonts 下载后自托管，按 400–600 的可变字重区间请求，每个编号切片一个文件同时覆盖 400、500、600 三档；切片以 unicode-range 声明，浏览器只下载页面实际用到的字。由于 `@nuxt/fonts` 只解析字体栈的第一个家族，`--font-sans` 必须以 `'Noto Sans SC'` 开头。

### Hierarchy
- **Headline**（600，17px，行高 1.35）：品牌名「AI修图大师」、导航栏里的工程名与页面标题、检查器中当前对象的名字（图层名、「裁剪与校正」）、弹窗标题。同屏只出现一到两处。
- **Title**（600，15px，行高 1.4）：面板里的分组标题，如「调色建议」「区域」「画笔」「光线」「读图模型」。不加小号大写眉标，只靠字号和字重与正文区分。
- **Body**（400，14px，行高 20px）：正文、导航项、设置行标签、AI 的整体分析段落（行高放宽到 relaxed）。
- **Body Strong**（500，14px）：按钮文字、建议卡片标题、工程卡片名称。
- **Label**（400，12px，行高 16px）：说明文字、参数名与数值、保存状态、元信息（尺寸、时间、tokens）。面板标签「属性」用 14px 500 的弱化色，比分组标题更轻。
- **Mono**（400，11px，行高 1.625）：重绘建议里的英文提示词；模型名输入框也用等宽，但沿用输入框自身的字号。

### Named Rules
**「一套黑体」规则。** 除提示词和模型名用等宽外，界面文字只用思源黑体，字重只取 400、500、600 三档。层级靠字号与字重表达，不为标题引入第二种展示字体。

**「数字对齐」规则。** 所有会变化的数字（参数值、尺寸、耗时、tokens、候选编号）都加 `tabular-nums`，拖动滑块时数字不跳动。

## Layout

**应用外壳**（图库、相册与设置页）：左侧 14rem 的毛玻璃导航侧栏，结构与 macOS「照片」相同。顶部是 24px 的应用图标（与安装包、启动画面同一个源文件 `public/app-icon.svg`）和品牌名；下面是「图库」，再往下是「相册」分组，列出每个相册的 emoji 或封面、名称和工程数；底部是「设置」和外观三段切换；网页版且站点提供了桌面版安装包时，「设置」上方多一行「下载桌面版」，与导航项同一个样式（图标、14px 弱化色文字），右侧是 12px 的版本号，不是页面链接而是直接下载。右侧是 deep 底的内容区，顶栏高 3.25rem，标题居左、主操作居右。图库页与相册页共用同一套工程网格，内容最宽 72rem；设置页最宽 48rem；两者都水平居中。图库为空时，拖放区是唯一的入口，不再在下面重复一个「还没有工程」；空相册的空状态说明怎样把已有工程移进来。第一次打开（还没走过向导、读图接口也没配好）时，外壳在启动页面之上弹出 42rem 宽的三步配置向导：欢迎（三条要点，图标用弱化墨色）、连接接口、选择模型与测试连接，三步的弹窗高度相同（按网页版最高的连接接口一步定），换步时不跳动。网页版且站点提供了桌面版安装包时，欢迎页三条要点下面多一行描边圆角卡片：左边「Windows 桌面版」加一行弱化小字（只写桌面版独有的功能，不拿网页版的不足做文案；面向普通用户，不出现接口、跨域这类术语），右边是描边的「下载」按钮；它只占一行，不能把欢迎页撑得比连接接口一步更高。连接接口一步最上面是单独一组的「PawBuddy 账户」设置行，标签后跟中性描边的「推荐」徽章，右侧是凸起灰的「登录 PawBuddy」和幽灵按钮「粘贴连接码」；下面一行弱化小字「或者使用自己的接口」引出 Base URL、API Key 一组。连上账户后这一行改为「已连接 邮箱」加描边的「充值」「断开」，手动填写的一组收起；设置页读图分组的第一行也是它。连着账户时模型与思考等级由账户预设、不能改，界面上干脆不显示：向导最后一步改为「准备就绪」，用与欢迎页相同的三条要点说明已连接的账户、模型已配好、按用量扣费，下面仍是测试连接；设置页收起读图的模型与思考等级、修图的「沿用读图模型的连接配置」与模型这几行，其余选项照常。走完、点「稍后设置」、右上角关闭或按 Esc 都算走过，以后不再弹出；点到弹窗外不关闭。没配好时图库顶部的提示条仍是去设置页的入口。

**编辑器**是三栏工作台，三栏都可拖动调宽并记住尺寸：
- 左栏：毛玻璃侧栏，默认 21rem（16–32rem）。顶部只有一个「‹ 工程」返回按钮，下面第一眼就是「AI 建议 / 图层」分段控件，再往下是建议分组或图层列表。
- 中栏：统一工具栏（工程名、保存状态、撤销、重做、对比原图、凸起的「导出」；桌面版换成凸起的「保存」（悬停说明它覆盖原图），右侧并着一个下拉箭头，菜单里是「导出…」），下面是工具条（选择、画笔、擦除、裁剪；缩放控制在右侧），再下面是 deep 底的画布凹槽，照片居中。
- 右栏：mid 底的属性检查器，默认 19rem（15–28rem），按「区域 → 画笔 → 光线 → 颜色 → 细节」纵向分组。区域、画笔和参数三大块之间用 1px 分隔线，光线、颜色、细节这些参数分组之间只留 20px 间距。

**间距节奏**以 4px 为基数。控件内部和相邻控件之间用 2–8px，卡片内边距 12px，设置行内边距 12px × 16px，面板内分组之间 16–20px，页面级区块之间 32–40px。工程缩略图网格窄屏 2 列、≥640px 3 列、≥1024px 4 列，间距 16px，缩略图比例 4:3。

**响应式**：低于 1024px 时侧栏收进抽屉，由导航栏左侧按钮打开；低于 640px 时设置行从「标签左、控件右」改为上下堆叠（开关行仍保持同一行），工具栏里的保存状态文字隐藏。所有宽度下都不允许横向滚动。

## Elevation & Depth

这是一套以色调分层为主的扁平系统。静止的表面没有阴影，深度完全由三档背景和 1px 发丝线表达：越「靠里」的区域越深（画布凹槽、内容区底），越「靠近手指」的元素越浅（凸起按钮、分段控件选中段）。唯一的透明材质是毛玻璃：侧栏为 80% 不透明的 deep 色加上 24px 背景模糊，底下铺着当前照片缩略图放大 110%、模糊 40px、饱和度提高 50% 的副本，侧栏因此只拾取照片的色调而不显示细节。下拉菜单和通知条也是半透明模糊（85% 的面板色），画布上的浮动标签（「原图」、渲染错误、候选编号）用 80% 的 deep 色加模糊。

### Shadow Vocabulary
- **浮层阴影**（`box-shadow: 0 2px 8px rgba(0,0,0,0.3)`）：只给真正浮在内容之上的东西：下拉菜单、提示气泡、弹窗、通知条。
- **旋钮阴影**（`box-shadow: 0 1px 2px rgba(0,0,0,0.35)`）：开关滑块和滑块拇指，让白色旋钮在轨道上可辨认。

### Named Rules
**「发丝线代替阴影」规则。** 卡片、面板、按钮在静止时都不投影；需要分隔就用 1px 发丝线。任何阴影都不超过 0 2px 8px。

**「一扇窗」规则。** 大面积透明只属于毛玻璃侧栏。不得用实色或渐变盖住侧栏透出的照片色调；修可读性只能提高文字层级，或者微调侧栏材质的不透明度。

## Shapes

形状语言是 macOS 的柔和矩形：圆角克制，同一层级的东西圆角一致。

- **控件**（按钮、输入框、下拉框、分段控件外框、导航项、图层行、候选图）用 8px 圆角。
- **分组与容器**（建议卡片、设置分组、工程缩略图卡片、拖放区、弹窗、提示条、通知条）用 12px 圆角。
- **小元素**（徽章、提示气泡、分段控件的选中段、画布浮动标签内的编号牌）用 6px 圆角；参数名这种纯文字按钮的焦点框用 4px。
- **开关与滑块**：开关轨道是胶囊形，开关滑块和滑块拇指是圆形。这是对风格原文「禁止 rounded-full」的有意偏离，依据是 macOS 原生开关和滑块的形态；除这两种控件外，不得出现胶囊按钮或圆形标签。
- **边框**一律 1px。拖放区是唯一的虚线框。选中的候选图用 1px 系统蓝外框加左上角勾号，而不是加粗边框。焦点环是 2px 的系统蓝 outline（60% 不透明度），输入类改为内描边加 3px 浅色光圈；两者都不占布局，也不是边框。

## Components

### Buttons
*像 macOS 的推压按钮：低调、实心、靠一档更浅的灰从面板上「凸」出来。*
- **Shape:** 柔和矩形（8px）。带文字的按钮统一 36px 高、左右内边距 12px；同排的图标按钮与之等高。更小的尺寸只用于图层行里的图标按钮这类密集场景。
- **Primary（凸起）：** 凸起灰填充 + 1px 发丝线内描边 + 高亮文字，如「导出」（桌面版是「保存」）「分析照片」「生成」「应用所选」「完成」。悬停时填充提亮一档（暗色混入 8% 白，亮色混入 4% 黑）。
- **弹窗确认（系统蓝）：** 弹窗底部的确认按钮用系统蓝实心填充、无描边、亮暗都是白字，如「新建相册」、导出弹窗里的「导出」、更换图标弹窗里的「完成」。悬停时填充降到 75% 不透明度，沿用 Nuxt UI 默认。弹窗里的删除确认仍按危险操作处理。弹窗底部一律用 `DialogActions` 组件（「取消」+ 确认），不手写按钮；它按 `danger` 决定用系统蓝（`color="secondary"`，`--ui-secondary` 与系统蓝同值）还是红字凸起灰。分步弹窗（配置向导）也用它：向导不能跳过，没有标题栏关闭按钮，Esc 与点到弹窗外也关不掉；第一步用 `hide-cancel` 不显示取消按钮，之后是「返回」，确认按钮是「继续」、最后一步是「开始使用」；欢迎页内容少，三步等高留出的空白由 64px 的应用图标（与启动画面同一个源文件）加居中的要点列表填上；底部左侧三个 6px 圆点标出第几步，与 macOS 的页面指示点一样是灰的，当前步用弱化墨色、其余用发丝线色，不用系统蓝。
- **Secondary（描边）：** 透明底、1px 发丝线描边、弱化文字，如「采纳」「测试连接」「调整图层」「清除裁剪」。悬停时叠一层悬停色并把文字提到高亮。
- **Ghost（工具按钮）：** 无边框无底色的图标按钮，如撤销、重做、缩放。选中的工具改为选中底 + 系统蓝图标。
- **危险操作：** 仍是凸起灰底，只把文字改成错误红，例如删除工程弹窗里的「删除」。
- **Hover / Focus：** 只有颜色在 200ms ease-out 内过渡；键盘焦点显示 2px 系统蓝 outline。禁用时整体 50% 不透明度。

### Chips（徽章）
- **Style:** 6px 圆角的小号徽章。区域类型用透明底 + 1px 发丝线，参数变化（「曝光 -0.80」）用悬停色的浅底，图层的「AI」来源标记用透明底。
- **State:** 状态色只落在文字上，外框保持中性发丝线；徽章从不铺强调色底。

### Cards / Containers
- **Corner Style:** 12px。
- **Background:** 面板色（mid），压在 deep 底或毛玻璃侧栏上。
- **Shadow Strategy:** 无阴影，见 Elevation & Depth。
- **Border:** 1px 发丝线；可交互的卡片悬停时外框加深到强调档，底色换成混色后的实色。
- **Internal Padding:** 12px；卡片之间 8px。
- **设置分组：** 同样是 12px 圆角的面板色容器，行与行之间用 1px 分隔线，每行 12px × 16px 内边距，标签与说明在左、控件在右（控件列宽 18rem）。

### Inputs / Fields
- **Style:** 8px 圆角，1px 强调档发丝线内描边，32px 高。暗色下输入框底是最深的石墨色（比所在面板更「凹」），亮色下是纯白。文字在 ≥768px 时为 14px，更窄时为 16px（避免移动浏览器聚焦时自动放大）。多行输入框随内容自动增高。
- **Focus:** 内描边换成 60% 的系统蓝，外侧再加一圈 3px、25% 不透明度的系统蓝焦点光圈（沿用 Nuxt UI 默认，接近 macOS 的焦点光圈）；输入光标和文本选区也是系统蓝。
- **Disabled:** 禁用时 75% 不透明度。本应用的字段没有行内校验错误态，接口错误通过通知条反馈。

### Navigation
- **侧栏导航：** 14px 文字的导航项，8px 圆角，6px × 10px 内边距。默认弱化色，悬停叠悬停色并提亮文字；当前页为选中底 + 高亮文字 + 系统蓝图标。
  - 行尾的数量是 12px 弱化色的等宽数字。
  - 相册行的图标位放用户选的 emoji（15px，占 18px 方格）；没选 emoji 时用 18px、4px 圆角的封面，封面取相册里最近修改的那张照片；空相册退回文件夹图标。emoji 是界面上唯一自带颜色的图形，只出现在这个 18px 方格和「移到相册」子菜单的图标位，面积小到不干扰对照片色彩的判断。
  - 「相册」分组标题是 12px 500 弱化色，与底部的「外观」标签同级，右侧是新建相册的加号图标按钮。
  - 新建相册用弹窗：名称输入框（打开即聚焦，回车创建）和图标选择，创建后进入该相册。相册页标题栏的重命名仍是就地输入框，不弹窗；在侧栏右键相册选「重命名相册」时，那一行直接换成同高的输入框。「更换图标」用同样的图标选择弹窗，侧栏右键与相册页共用一个。
  - 图标选择：第一项「照片封面」（图片图标，表示不用 emoji），其后按常用、人物、动物、自然、旅行、美食、节日与运动分组的 emoji，组标题与「相册」分组标题同级。每组是一个单选组，Tab 每组停一次，组内左右方向键按顺序移动；方格 8px 圆角，悬停叠悬停色，选中为选中底 + 1px 系统蓝描边。选项放在最高 20rem 的滚动区域里。
  - 还没有相册时，分组下显示一行「还没有相册」。
  - 「图库」与相册行也是工程卡片的放下目标：拖着卡片停在可以接受的那一行（不是工程已经所在的相册）上时，描一圈 2px 系统蓝，与右键菜单打开时的描边同一个样式，不换底色；放下后弹出「已移到相册」或「已移出相册」的提示。不能接受的行没有任何反馈，光标显示禁止。
  - 工程卡片的拖动：被拖的卡片淡到 50%（等拖动图像生成之后才淡，拖动图像本身保持原样）；顶部的拖放区在拖动期间停用，不会因为卡片拖过而亮起。网格里排序时，目标卡片与相邻卡片之间的空隙里出现 2px 系统蓝竖线，标出放下后的位置（指针在目标卡片左半边是它之前，右半边是它之后）；指针在空隙里时保持上一次的位置，竖线不闪。放下后其余卡片用列表过渡让位。
  - 图库页与相册页标题行右侧是「排序：最近修改」菜单按钮（幽灵按钮，前置上下箭头图标、后置下箭头）；只有一个工程时不显示。菜单是带对勾的单选：最近修改、创建时间、名称、手动排序。标题在最近修改时是「最近的工程」，其余方式是「工程」；手动排序时按钮左边多一行 14px 弱化色的「拖动卡片调整顺序」。
  - 图库页标题行里，排序按钮左边是「全部 / 按相册」切换展示方式（分段控件，见下），只有至少一个相册、图库里有工程时才出现；相册页没有。「按相册」时每个相册是一组：组标题是相册的 emoji（没有就是文件夹图标）、14px 600 的相册名、一个弱化色的右箭头（提示它是进入该相册的链接，悬停叠悬停色）和 12px 弱化色的数量，下面是同样的卡片网格；没有工程的相册不出现，没放进相册的收在最后一组，标题是图片图标加「未放入相册」，不是链接。组与组之间 32px，标题与网格 12px。组内的卡片按当前排序方式排列。拖着别组的卡片停在某一组的网格上时，整个网格外圈描一圈 2px 系统蓝（与侧栏放下目标同一个样式），放下后移进那个相册；拖着本组的卡片则是排序，用竖线标出位置。
- **分段控件（切换视图）：** 外框是透明底 + 1px 发丝线 + 2px 内边距，选中段是凸起灰（6px 圆角），切换时像 macOS 分段控件一样滑到新位置（200ms）。用于编辑器左栏的「AI 建议 / 图层」和图库页的「全部 / 按相册」（图标加文字，不带内容面板，只负责切换）；「图层」后的数量徽章每次变化都从 60% 落定到原大，采纳一条建议时能看到它变成了一个图层。
- **分段选择（选取一个值）：** 外框相同，选中段改为选中底 + 系统蓝图标，与工具选中的语义一致。用于检查器里的区域形状和侧栏底部的外观切换（跟随系统、浅色、深色）。
- **移动端：** 低于 1024px 时侧栏变成抽屉，由导航栏左侧的按钮打开。

### 毛玻璃侧栏（招牌组件）
窗口最底层铺着当前照片的缩略图（放大、强模糊、提高饱和度），只从半透明侧栏处透出。工程列表透出最近修过的那张照片，编辑器透出当前工程的照片，因此每个工程的侧栏色调都不同。底图挂在应用根部、跨页面常驻，换成另一张照片时新图在上方用 700ms 溶解进来，旧图垫在下面直到被盖住，侧栏色调不会中途变暗或随路由突变。侧栏上的文字至少用弱化档，见「玻璃上不放最弱文字」规则。

### 参数滑块（零点双向填充）
参数名在左、数值在右（12px，等宽数字），下面是 7px 高的轨道。跨零的双极参数（曝光、对比度、高光、色温、水平校正等）从 0 点向两侧填充，未改动时没有填充，数值显示为最弱档；改动后数值变为高亮加粗，填充段用系统蓝标出改了多少。单极参数（强度、羽化、笔刷大小、硬度、导出质量）从最小值开始填充。双击参数名或滑块恢复默认值。

### 分析进度框
点「分析照片」后按钮换成描边的「取消分析」，下面展开与重绘任务框同款的进度框（12px 圆角、1px 发丝线、无底色）：第一行是加载图标加当前阶段（「AI 正在看照片 / 正在思考 / 正在写修图方案」，格式不对重写时为「刚才的方案格式不对，正在重写」）和右侧的用时。服务返回思考过程时，下面是 deep 底、最高 160px 的思考区，12px 弱化色、保留换行，跟着最新文字滚到底，用户往上翻看时不打扰。开始写方案后，再往下逐字出现总评（14px 正文色）和建议标题列表，每条前面是与图层列表相同的类型图标（调色 sliders、重绘 wand、构图 crop），新条目淡入。界面只显示这些从方案里提取的文字，从不显示 JSON。结果返回时进度框立即移除，结果在原处依次浮现，草稿与结果不会同时出现两份。

### 采纳操作与「已采纳」标签
建议卡片右上角未采纳时是描边按钮「采纳」；采纳后换成不可交互的状态标签：对勾图标加「已采纳」文字，弱化色、同样 36px 高，卡片不跳动。按钮立即移除，标签淡入、对勾落定；初次渲染时已采纳的项不播放。不得用半透明的禁用按钮表达「已完成」。

### 检查器层级
检查器顶部的「属性」是面板标签（14px 500 弱化色），当前对象名用 Headline（17px 600），下面的「区域 / 画笔 / 光线 / 颜色」用 Title（15px 600），三级一眼可分。

### 浮层
下拉菜单、操作菜单和提示气泡与 macOS 一样不缩放，只做 100ms 淡入淡出。操作菜单用于工程卡片的「更多操作」（移到相册的子菜单、移出相册、删除工程）和相册页的「相册操作」（重命名、更换图标、删除），外观与下拉菜单一致；危险项只把文字改成错误红，高亮时仍用中性的选中底。
右键菜单与操作菜单是同一种浮层，在指针处打开：工程卡片与侧栏相册的右键菜单和各自的「更多操作」「相册操作」内容相同；图层行的右键菜单是行内按钮的全部操作加上重命名，已在最上、最下的图层禁用上移、下移；画布的右键菜单是撤销重做、四个工具（当前工具打勾，勾在快捷键前面，快捷键列保持右对齐）与缩放。菜单打开期间，被右键的对象描一圈 2px 系统蓝（与 macOS 的右键高亮一致），右键图层同时选中它。从右键菜单重命名时，输入框就出现在原处（侧栏的那一行、图层行），菜单关闭后焦点留在输入框里。没有应用菜单的位置不弹出浏览器（桌面版是 WebView）自带的菜单，网页版与桌面版一致；输入框里与选中文字时仍保留系统的剪切、复制、粘贴。弹窗从 95% 放大淡入（200ms），关闭时直接淡出（150ms）；通知条从屏幕边缘滑入。蓝色确认按钮就是弹窗的默认按钮：打开时焦点停在弹窗本身（有输入框时在输入框里），焦点在输入框、单选项、滑块上或停在弹窗本身时回车即确认；焦点在其他按钮、多行文本或下拉框上时回车交给它们，输入法组字时的回车只用来上屏。危险弹窗没有默认按钮，焦点停在关闭按钮上，回车只关掉弹窗。弹窗遮罩是 20%（暗色 45%）的黑。下拉菜单的高亮项用 6px 圆角的选中底。

### 等待指示
启动、分析中、生成中、加载图像时显示旋转的加载图标，这是唯一的循环动画；系统开启「减少动态效果」时旋转停止，文字说明仍然可见。

### 启动画面
应用脚本跑起来之前，deep 底正中显示 64px 的应用图标，随窗口出现 240ms 淡入；超过 800ms 仍未启动完，图标下方才浮现等待指示和「正在启动…」（14px 弱化色）。正常启动只看到图标，不会多闪一下转圈。界面挂载后启动画面直接移除：它与外壳同为 deep 底，切换时只有图标被界面替换。

### 动效
动效只回答三件事：操作被接收了吗（反馈）、什么变了（状态）、东西去哪了（连续性）。不做装饰、循环、视差、滚动入场和回弹。
- **曲线与时长：** 全局一条指数减速曲线 `cubic-bezier(0.16, 1, 0.3, 1)`（覆盖 Tailwind 的 `--ease-out`，Nuxt UI 浮层同用）。即时反馈 100–150ms，常规状态 150–300ms，招牌时刻 500–700ms；离场比入场快。
- **招牌时刻（照片合焦）：** 照片第一次落到画布上时，从 12px 柔焦、全透明在 560ms 内清晰起来；重绘的中间图和候选图到达时用同一种合焦（480ms），只在面板打开期间生成出来的候选上播放。
- **颜色：** 按钮、导航项、卡片、开关轨道只做 200ms 颜色过渡；开关旋钮 200ms 平移。
- **展开与收起：** 依赖开关或形状的设置行、羽化滑块、渐变说明、锁定提示、重绘任务框、分析进度框与其中的思考区和总评、导出质量与进度，以高度、内边距和透明度一起展开（260ms），收起更快（180ms）。高度过渡依赖 `interpolate-size`，不支持的浏览器只淡入淡出。
- **列表：** 图层上移、下移、增删、撤销重做，以及删除工程时，其余条目用 FLIP 平滑让位（260ms），被删条目钉在原位淡出并缩到 97%。
- **视角：** 缩放按钮、适应窗口、1:1、快捷键 0，以及进入和退出裁剪，画布视角在 280ms 内移动；缩放按对数插值。滚轮和拖动平移始终直接跟手，并打断进行中的过渡。
- **内容更替：** 新的读图结果按「整体分析 → 调色 → 重绘 → 构图 → 模型信息」依次浮现，相邻间隔 60ms，总时长不超过 560ms；检查器换对象时内容 150ms 淡入；页面切换用浏览器视图过渡整页交叉淡化 180ms；工程缩略图解码后才淡入。
- **减少动态效果：** 去掉位移、缩放、模糊和高度变化，保留透明度和颜色；视角直接到位，视图过渡跳过，等待旋转停止。

## Do's and Don'ts

### Do:
- **Do** 只用 deep / mid / surface 三档背景和 1px 发丝线（8%–12%）表达层级。
- **Do** 把系统蓝限定在焦点环、选中工具图标、导航激活图标、滑块填充、开关开启、选中候选框和弹窗确认按钮上。
- **Do** 主按钮用凸起灰填充，次按钮用透明底加 1px 描边，工具按钮无边框。
- **Do** 带文字的按钮保持 36px 高，同排图标按钮与之等高。
- **Do** 界面文字统一用思源黑体，标题靠字号与字重区分（Headline 17px / Title 15px，600），提示词和模型名用等宽。
- **Do** 毛玻璃侧栏上的说明文字至少用弱化档；最弱档只放在不透明底上。
- **Do** 让按钮、导航项、图层行等可聚焦元素显示 2px 系统蓝 outline（60%），输入类显示系统蓝内描边加 3px 浅色光圈；给会变化的数字加等宽数字。
- **Do** 同时验证亮色和暗色两套外观，以及纯白、纯黑照片作为侧栏底图的最坏情况。
- **Do** 每处动效都说得出它解释的是反馈、状态还是连续性；统一用 `--ease-out`，并为「减少动态效果」提供只保留透明度与颜色的降级。

### Don't:
- **Don't** 使用紫色主色、渐变按钮、发光或彩色描边光晕。
- **Don't** 用系统蓝或任何语义色铺按钮（弹窗确认按钮除外）、面板、徽章或提示条的底色。
- **Don't** 给静止的卡片、面板、按钮加阴影；浮层阴影不超过 0 2px 8px。
- **Don't** 使用 2px 或更粗的边框，也不要用加粗边框表示选中。
- **Don't** 做胶囊形按钮或圆形标签；胶囊轨道和圆形旋钮只属于开关和滑块。
- **Don't** 用实色或渐变盖住毛玻璃侧栏透出的照片色调。
- **Don't** 在分组标题上加小号大写眉标，或让分组标题与对象名使用同一字号。
- **Don't** 加装饰性动画：不做循环（等待旋转除外）、视差、滚动入场、悬停上浮或回弹曲线；菜单和提示气泡不缩放。
- **Don't** 用半透明的禁用按钮表达「已完成」之类的状态，改用不可交互的状态标签。
