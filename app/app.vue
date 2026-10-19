<script setup lang="ts">
import { zh_cn } from '@nuxt/ui/locale'

const backdrop = useBackdrop()
</script>

<template>
  <UApp
    :locale="zh_cn"
    :toaster="{ position: 'bottom-right', progress: false }"
  >
    <AppBackdrop :image="backdrop" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
