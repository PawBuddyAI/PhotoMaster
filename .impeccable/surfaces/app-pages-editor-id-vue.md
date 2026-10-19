---
version: 1
slug: "app-pages-editor-id-vue"
primary_target: "app/pages/editor/[id].vue"
related_targets: ["app/pages/index.vue","app/pages/settings.vue","app/layouts/default.vue"]
---

# 编辑器与应用外壳（首页、设置、编辑器）

## Scope

- 访客模式：Operate。用户来完成修图任务，界面首先是一款合格的桌面修图工具。
- 范围：工程列表首页、设置页、编辑器三栏界面，以及共用的 Nuxt UI 组件主题。
- 用户：自带 OpenAI 兼容接口的摄影爱好者，桌面浏览器，长时间停留在编辑器。
- 约束：保持全部功能、文案、快捷键与 e2e 依赖的按钮名称不变；亮/暗两套外观并保留切换；动效只用于反馈、状态与连续性，不做装饰（2026-10-19 起取代「除等待旋转外去掉所有动画」）。

## Direction contract

THESIS: 照片就是这扇窗的壁纸。侧边栏的毛玻璃透出当前照片的模糊色调，就像 macOS 侧栏透出桌面；除此之外全部靠三级深灰和 1px 发丝线分层。拒绝 AI 工具的品类默认：紫色主色、渐变按钮、卡片堆叠的营销式面板。

OWN-WORLD: 暗色 #1c1c1e / #2c2c2e / #3a3a3c，亮色 #e5e5ea / #f2f2f7 / #ffffff。分隔线一律 1px，白（黑）8–12%。系统蓝 #0a84ff（亮色 #007aff）只出现在焦点环、选中工具图标、滑块填充、开关开启和选中候选框上，从不做按钮或面板底色。主按钮是凸起灰（#3a3a3c）填充，次按钮透明描边，工具按钮无边框。标题用 Georgia + Noto Serif SC 衬线，正文用系统无衬线，提示词和数值用 SF Mono / Menlo。控件 rounded-lg，分组 rounded-xl，阴影不超过 0 2px 8px，没有渐变和发光。

STORY: 用户打开工程列表，一眼看出最近修过的照片；进入编辑器后，左栏的颜色随照片变化，让人意识到这是“这张照片的工作台”。读图建议以安静的分组卡片排开，采纳后变成图层，右侧检查器像 macOS 检查器一样按区域、光线、色彩、细节分组。整个界面退到照片后面。

FIRST VIEWPORT: 编辑器：左侧 21rem 毛玻璃侧栏（顶部是分段控件「AI 建议 / 图层」，下方是建议分组）；中间是统一工具栏（衬线工程名、撤销、重做、对比、凸起的「导出」）、工具条，以及 #1c1c1e 画布凹槽里的照片；右侧是 #2c2c2e 属性检查器。图库：左侧毛玻璃导航（品牌名、图库、相册分组与各相册的封面和数量，底部是设置与外观切换）；内容区顶栏为标题「图库」（相册页为相册名与相册菜单）和「导入照片」，下方是拖放凹槽和缩略图网格。设置页：系统设置式分组行，标签在左、控件在右。

FORM: 用户指定的 macOS Vibrancy 风格（固定方向，排序第 1，无掷骰）。seed: none (brief-pinned, no roll)。招牌交互：照片着色的毛玻璃侧栏，每个工程的侧栏色调都不同。动效论点：打开照片时画布上的照片像镜头合焦一样清晰起来、侧栏同时溶解成这张照片的色调；其余动效只做反馈、状态与连续性（颜色过渡、展开收起、列表让位、视角移动），统一指数减速曲线。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
