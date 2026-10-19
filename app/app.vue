<script setup lang="ts">
import { zh_cn } from '@nuxt/ui/locale'
</script>

<template>
  <UApp
    :locale="zh_cn"
    :toaster="{ position: 'bottom-right', progress: false }"
  >
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
