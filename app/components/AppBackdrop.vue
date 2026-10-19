<script setup lang="ts">
/**
 * 铺满窗口的照片底图，只在半透明侧栏处透出。
 * 缩略图本身分辨率很低，放大后再模糊即可得到柔和的色块，侧栏只拾取它的色调。
 * 挂在应用根部、跨页面常驻：换照片时新旧两张溶解过渡，侧栏色调不会随路由切换突变。
 */
const props = defineProps<{ image: Blob | null | undefined }>()

/** 旧图在溶解期间仍在显示，等过渡结束再释放它的地址 */
const RELEASE_DELAY = 1000

const url = ref<string | null>(null)

watch(() => props.image, (blob, _, onCleanup) => {
  if (!blob) {
    url.value = null
    return
  }
  const objectUrl = URL.createObjectURL(blob)
  url.value = objectUrl
  onCleanup(() => setTimeout(() => URL.revokeObjectURL(objectUrl), RELEASE_DELAY))
}, { immediate: true })
</script>

<template>
  <div
    aria-hidden="true"
    class="pointer-events-none fixed inset-0 isolate overflow-hidden"
  >
    <Transition name="backdrop">
      <img
        v-if="url"
        :key="url"
        :src="url"
        alt=""
        class="absolute inset-0 size-full scale-110 object-cover blur-2xl saturate-150"
      >
    </Transition>
  </div>
</template>
