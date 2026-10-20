<script setup lang="ts">
/** 「移到相册」子菜单里代替文件夹图标的相册 emoji，与菜单图标同占 16px 方格 */
defineProps<{ emoji: string }>()
</script>

<template>
  <span
    aria-hidden="true"
    class="flex size-4 shrink-0 items-center justify-center text-sm leading-none"
  >{{ emoji }}</span>
</template>
