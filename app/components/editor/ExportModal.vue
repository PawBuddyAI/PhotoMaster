<script setup lang="ts">
import { cropOutputSize } from '~/lib/geometry/crop'
import type { ExportFormat } from '~/lib/image/export'
import { useEditorStore } from '~/stores/editor'

const open = defineModel<boolean>('open', { required: true })
const editor = useEditorStore()
const notify = useNotify()
const { exporting, progress, run } = useExport()

const format = ref<ExportFormat>('image/jpeg')
const quality = ref(0.92)
const keepExif = ref(true)

const formatItems = [
  { label: 'JPEG', value: 'image/jpeg' },
  { label: 'PNG（无损）', value: 'image/png' },
  { label: 'WebP', value: 'image/webp' }
]

const meta = computed(() => editor.project)
const outputSize = computed(() => meta.value ? cropOutputSize(editor.doc.crop, meta.value.width, meta.value.height) : null)
const canKeepExif = computed(() => format.value === 'image/jpeg' && meta.value?.originalType === 'image/jpeg')

async function start() {
  try {
    const result = await run({ format: format.value, quality: quality.value, keepExif: keepExif.value && canKeepExif.value })
    notify.success('导出完成', `${result.width}×${result.height}，${(result.blob.size / 1024 / 1024).toFixed(1)} MB`)
    open.value = false
  } catch (err) {
    notify.error(err)
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="导出"
    description="按原图分辨率渲染所有图层与裁剪"
    :dismissible="!exporting"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="格式">
          <USelect
            v-model="format"
            :items="formatItems"
            class="w-full"
            :disabled="exporting"
          />
        </UFormField>
        <!-- PNG 无损没有质量参数：切换格式时滑块原地收起、展开 -->
        <Transition name="reveal">
          <EditorParamSlider
            v-if="format !== 'image/png'"
            v-model="quality"
            label="质量"
            :min="0.5"
            :max="1"
            :step="0.01"
            :default-value="0.92"
            :disabled="exporting"
            :format="v => `${Math.round(v * 100)}`"
          />
        </Transition>
        <USwitch
          v-model="keepExif"
          label="保留 EXIF 信息"
          :description="canKeepExif ? '相机型号、拍摄参数等（方向会重置为正常）' : '仅 JPEG 原图导出为 JPEG 时可保留'"
          :disabled="!canKeepExif || exporting"
        />
        <p
          v-if="outputSize"
          class="text-sm text-muted tabular-nums"
        >
          输出尺寸 {{ outputSize.w }}×{{ outputSize.h }}
        </p>
        <Transition name="reveal">
          <UProgress
            v-if="exporting"
            :model-value="progress * 100"
            size="sm"
          />
        </Transition>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          :disabled="exporting"
          @click="open = false"
        />
        <UButton
          icon="i-lucide-download"
          label="导出"
          :loading="exporting"
          @click="start"
        />
      </div>
    </template>
  </UModal>
</template>
