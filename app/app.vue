<script setup lang="ts">
import { zh_cn } from '@nuxt/ui/locale'

const backdrop = useBackdrop()
const { load: loadDesktopRelease } = useDesktopRelease()

// 编辑器不在默认布局里，下载入口的数据放在根组件加载，任何页面出错提示都能带上「下载桌面版」
onMounted(loadDesktopRelease)
</script>

<template>
  <UApp
    :locale="zh_cn"
    :toaster="{ position: 'bottom-right', progress: false }"
  >
    <AppBackdrop :image="backdrop" />
    <BalanceDialog />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
