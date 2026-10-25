<script setup lang="ts">
import { normalizeRawDevelop, type RawDevelop } from '~/lib/image/raw-develop'
import type { RawLookStyle } from '~/lib/image/raw-look'
import { defaultNoiseStrength } from '~/lib/image/raw-noise'
import { useEditorStore } from '~/stores/editor'

const editor = useEditorStore()
const notify = useNotify()
const { analyzing, ensure } = useRawProfile()

const develop = computed(() => normalizeRawDevelop(editor.doc.raw))
const profile = computed(() => editor.project?.rawProfile)
const defaults = computed(() => profile.value ? defaultNoiseStrength(profile.value.noise) : { luminance: 0, color: 0 })

const styles = computed(() => [
  {
    value: 'camera',
    label: '相机直出',
    description: profile.value && !profile.value.camera ? '这张照片没有可参考的相机预览，可以用「标准」' : '照着相机自己出的照片还原明暗和颜色',
    disabled: !profile.value?.camera
  },
  { value: 'standard', label: '标准', description: '通用的明暗和对比，适合大多数照片' },
  { value: 'none', label: '不加处理', description: '保留原始数据，画面偏暗偏灰，适合从头调色' }
])

onMounted(() => {
  ensure().catch(error => notify.error(error))
})

function update(patch: Partial<RawDevelop>, coalesceKey?: string) {
  editor.setRaw({ ...develop.value, ...patch, noise: { ...develop.value.noise, ...patch.noise } }, coalesceKey)
}
</script>

<template>
  <div class="space-y-5">
    <div class="space-y-1">
      <h3 class="panel-title">
        RAW 基础
      </h3>
      <p class="text-xs/relaxed text-muted">
        在所有图层之前起作用；改这里不会影响已有的调整图层。
      </p>
    </div>

    <UAlert
      v-if="analyzing"
      color="neutral"
      variant="subtle"
      icon="i-lucide-loader-circle"
      title="正在分析这张照片"
      description="第一次打开要读一下 RAW 原件，几秒钟就好。"
      :ui="{ icon: 'animate-spin' }"
    />

    <section class="space-y-3">
      <h3 class="section-title">
        风格
      </h3>
      <URadioGroup
        :model-value="develop.look"
        :items="styles"
        variant="card"
        :disabled="!profile"
        aria-label="风格"
        @update:model-value="value => update({ look: value as RawLookStyle })"
      />
    </section>

    <section class="space-y-3">
      <h3 class="section-title">
        降噪
      </h3>
      <EditorParamSlider
        :model-value="develop.noise.luminance"
        label="亮度降噪"
        :min="0"
        :max="100"
        :default-value="defaults.luminance"
        :disabled="!profile"
        hint="抹平颗粒状的明暗噪点，太高会让细节变糊"
        @update:model-value="value => update({ noise: { ...develop.noise, luminance: value } }, 'raw:noise:luminance')"
      />
      <EditorParamSlider
        :model-value="develop.noise.color"
        label="颜色降噪"
        :min="0"
        :max="100"
        :default-value="defaults.color"
        :disabled="!profile"
        hint="去掉暗处红绿相间的彩色斑点"
        @update:model-value="value => update({ noise: { ...develop.noise, color: value } }, 'raw:noise:color')"
      />
      <p class="text-xs/relaxed text-muted">
        画布上看到的是缩小后的效果，细小的噪点以导出的照片为准。
      </p>
    </section>
  </div>
</template>
