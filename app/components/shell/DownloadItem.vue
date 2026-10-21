<script setup lang="ts">
/**
 * 侧栏底部的「下载桌面版」一行：外观与导航行一致，但不是页面链接，点击直接下载 Windows 安装包。
 * 只有网页版、且站点上有发布清单时才出现（桌面版自己就是客户端，没发布过时也不放打不开的链接）；
 * 右侧的版本号让人知道下的是哪一版，大小与差异说明在设置页。
 */
const { download } = useDesktopRelease()
</script>

<template>
  <a
    v-if="download"
    :href="download.url"
    download
    class="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted outline-primary/60 transition-colors duration-200 ease-out hover:bg-elevated hover:text-highlighted focus-visible:outline-2"
  >
    <UIcon
      name="i-lucide-download"
      class="size-4.5 shrink-0"
    />
    <span class="min-w-0 flex-1 truncate">下载桌面版</span>
    <span class="shrink-0 text-xs tabular-nums">v{{ download.version }}</span>
  </a>
</template>
