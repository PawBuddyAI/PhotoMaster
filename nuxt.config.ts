// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@pinia/nuxt'
  ],

  // 桌面版（src-tauri/tauri.conf.json 以 --envName tauri 启动 dev / generate）使用独立的构建目录：
  // Nuxt 对构建目录加锁，否则另一个开发服务器运行期间无法打包桌面版
  $env: {
    tauri: { buildDir: 'node_modules/.cache/nuxt-tauri' }
  },

  // 纯前端 SPA：所有图像处理与模型调用都在浏览器内完成。
  // 脚本跑起来之前显示启动画面 app/spa-loading-template.html（Nuxt 按约定文件名自动启用）
  ssr: false,

  devtools: {
    enabled: true
  },

  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: 'AI修图大师',
      link: [{ rel: 'icon', href: '/favicon.ico' }]
    }
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      // PawBuddy 网站：「使用 PawBuddy 账户」从这里的连接页授权（NUXT_PUBLIC_PAWBUDDY_SITE，构建时写入产物）
      pawbuddySite: 'https://pawbuddy.chat'
    }
  },

  // 路由切换走浏览器原生的视图过渡（整页交叉淡化，时长见 main.css）；系统开启「减少动态效果」时 Nuxt 自动跳过
  experimental: {
    viewTransition: true
  },

  compatibilityDate: '2026-06-30',

  vite: {
    // 图像 Worker 以 ES 模块形式构建，可直接复用 app/lib 中的模块
    worker: { format: 'es' },
    // 预构建运行时才被发现的依赖，避免开发时首次打开页面触发整页重载
    optimizeDeps: {
      exclude: ['libraw-wasm'],
      include: [
        'vue-konva', 'konva', 'dexie', 'openai', 'openai/helpers/zod', 'zod', 'twgl.js', 'comlink', 'piexifjs',
        '@tauri-apps/api/core', '@tauri-apps/plugin-dialog', '@tauri-apps/plugin-fs', '@tauri-apps/plugin-http'
      ]
    },
    // 桌面版（Tauri）开发：保留 Rust 编译输出，不监听 src-tauri（target 目录文件极多）
    clearScreen: false,
    server: {
      watch: { ignored: ['**/src-tauri/**'] }
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  fonts: {
    families: [
      {
        // 思源黑体（Google Fonts 上名为 Noto Sans SC）。Google 把 CJK 字体切成 [0]…[n] 编号切片并以 unicode-range 声明，
        // 默认子集只含拉丁与西里尔，需要显式列出编号切片；浏览器只下载页面实际用到的切片。
        // 界面只用 400/500/600 三档字重，按可变字重区间请求：每个切片一个文件覆盖三档，
        // 而 Google 对多个离散字重返回的也是同一批可变字体文件
        name: 'Noto Sans SC',
        provider: 'google',
        weights: ['400 600'],
        styles: ['normal'],
        subsets: ['latin', ...Array.from({ length: 128 }, (_, i) => `[${i}]`)]
      }
    ]
  }
})
