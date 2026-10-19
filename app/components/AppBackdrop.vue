<script setup lang="ts">
/**
 * 铺满窗口的照片底图，只在半透明侧栏处透出。
 * 缩略图本身分辨率很低，放大后再模糊即可得到柔和的色块，侧栏只拾取它的色调。
 */
const props = defineProps<{ image: Blob | null | undefined }>()

const url = ref<string | null>(null)

watch(() => props.image, (blob, _, onCleanup) => {
  if (!blob) {
    url.value = null
    return
  }
  const objectUrl = URL.createObjectURL(blob)
  url.value = objectUrl
  onCleanup(() => URL.revokeObjectURL(objectUrl))
}, { immediate: true })
</script>

<template>
  <img
    v-if="url"
    :src="url"
    alt=""
    aria-hidden="true"
    class="pointer-events-none fixed inset-0 size-full scale-110 object-cover blur-2xl saturate-150"
  >
</template>
