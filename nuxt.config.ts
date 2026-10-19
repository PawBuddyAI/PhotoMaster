// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@pinia/nuxt'
  ],

  // 纯前端 SPA：所有图像处理与模型调用都在浏览器内完成
  ssr: false,

  devtools: {
    enabled: true
  },

  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: 'AI 修图',
      link: [{ rel: 'icon', href: '/favicon.ico' }]
    }
  },

  css: ['~/assets/css/main.css'],

  compatibilityDate: '2026-06-30',

  vite: {
    // 图像 Worker 以 ES 模块形式构建，可直接复用 app/lib 中的模块
    worker: { format: 'es' },
    // 预构建运行时才被发现的依赖，避免开发时首次打开页面触发整页重载
    optimizeDeps: {
      include: ['vue-konva', 'konva', 'dexie', 'openai', 'openai/helpers/zod', 'zod', 'twgl.js', 'comlink', 'piexifjs']
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
        // 标题衬线的中文字形。Google 把 CJK 字体切成 [0]…[n] 编号切片并以 unicode-range 声明，
        // 默认子集只含拉丁与西里尔，需要显式列出编号切片；浏览器只下载页面实际用到的切片
        name: 'Noto Serif SC',
        provider: 'google',
        weights: [600],
        styles: ['normal'],
        subsets: ['latin', ...Array.from({ length: 128 }, (_, i) => `[${i}]`)]
      }
    ]
  }
})
