<script setup lang="ts">
import { cropOutputSize } from '~/lib/geometry/crop'
import type { ExportFormat } from '~/lib/image/export'
import { canKeepExif, DEFAULT_EXPORT_QUALITY } from '~/lib/image/export-options'
import { normalizeHdr } from '~/lib/image/hdr'
import { createHdrCopy, getProject } from '~/lib/storage/db'
import { useEditorStore } from '~/stores/editor'

const open = defineModel<boolean>('open', { required: true })
const editor = useEditorStore()
const notify = useNotify()
const { exporting, progress, run } = useExport()

const format = ref<ExportFormat>('image/jpeg')
const quality = ref(DEFAULT_EXPORT_QUALITY)
const keepExif = ref(true)
const { isHdr } = useProjectAssets()
const canUpgrade = ref(false)
const upgrading = ref(false)
watch([open, () => editor.project?.id], async () => {
  canUpgrade.value = false
  const id = editor.project?.id
  if (!open.value || !id || isHdr.value) return
  const project = await getProject(id)
  if (id === editor.project?.id) canUpgrade.value = !!project?.rawSource
})
async function upgrade() {
  if (!editor.project) return
  upgrading.value = true
  try {
    await editor.flush()
    const id = await createHdrCopy(editor.project.id)
    open.value = false
    await navigateTo(`/editor/${id}`)
  } catch (error) {
    notify.error(error)
  } finally {
    upgrading.value = false
  }
}
const hdr = computed(() => normalizeHdr(editor.doc.hdr))
const previewHdr = computed({ get: () => hdr.value.preview === 'auto', set: (value: boolean) => editor.setHdr({ ...hdr.value, preview: value ? 'auto' : 'sdr' }) })

const formatItems = computed(() => [
  { label: 'JPEG', value: 'image/jpeg' },
  { label: editor.project?.linearBlobId ? 'PNG（16 位，无损）' : 'PNG（无损）', value: 'image/png' },
  { label: 'WebP', value: 'image/webp' },
  ...(isHdr.value
    ? [
        { label: 'Ultra HDR JPEG（兼容 SDR）', value: 'image/ultrahdr' },
        { label: 'HDR PNG（16 位，Rec.2020 PQ）', value: 'image/png-hdr' },
        { label: 'OpenEXR（32 位浮点，无损）', value: 'image/x-exr' }
      ]
    : [])
])

const meta = computed(() => editor.project)
const outputSize = computed(() => meta.value ? cropOutputSize(editor.doc.crop, meta.value.width, meta.value.height) : null)
const exifAvailable = computed(() => !!meta.value && canKeepExif(format.value, meta.value.originalType, meta.value.raw))

async function start() {
  try {
    const result = await run({ format: format.value, quality: quality.value, keepExif: keepExif.value && exifAvailable.value })
    // 桌面版在另存为对话框中取消：保持弹窗打开，不提示
    if (!result) {
      return
    }
    const summary = exportSummary(result)
    notify.success('导出完成', result.savedPath ? `${summary}，已保存到 ${result.savedPath}` : summary)
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
    :dismissible="!exporting && !upgrading"
  >
    <template #body>
      <div class="space-y-4">
        <div
          v-if="canUpgrade"
          class="space-y-2"
        >
          <p class="text-sm text-muted">
            这是旧版 RAW 工程。可从保存的原件新建 HDR 副本；副本从未调整状态开始，旧工程保留。
          </p>
          <UButton
            label="从 RAW 新建 HDR 副本"
            variant="soft"
            :loading="upgrading"
            :disabled="exporting"
            @click="upgrade"
          />
        </div>
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
            v-if="['image/jpeg', 'image/webp', 'image/ultrahdr'].includes(format)"
            v-model="quality"
            label="质量"
            :min="0.5"
            :max="1"
            :step="0.01"
            :default-value="DEFAULT_EXPORT_QUALITY"
            :disabled="exporting"
            :format="v => `${Math.round(v * 100)}`"
          />
        </Transition>
        <div
          v-if="isHdr"
          class="space-y-4 border-t border-default pt-4"
        >
          <USwitch
            v-model="previewHdr"
            label="自动使用 HDR 屏幕预览"
            description="需要系统开启 HDR；不支持时自动显示色调映射预览。"
            :disabled="exporting"
          />
          <EditorParamSlider
            label="导出参考白（nit）"
            :model-value="hdr.referenceWhite"
            :min="80"
            :max="400"
            :step="1"
            :default-value="203"
            :disabled="exporting"
            @update:model-value="editor.setHdr(normalizeHdr({ ...hdr, referenceWhite: $event }))"
          />
          <EditorParamSlider
            label="HDR 交付峰值（nit）"
            :model-value="hdr.peakNits"
            :min="hdr.referenceWhite"
            :max="10000"
            :step="1"
            :default-value="1000"
            :disabled="exporting"
            @update:model-value="editor.setHdr(normalizeHdr({ ...hdr, peakNits: $event }))"
          />
          <p class="text-xs text-muted">
            {{ format === 'image/x-exr' ? 'EXR 保留未经色调映射的浮点值，不受交付峰值限制。' : ['image/ultrahdr', 'image/png-hdr'].includes(format) ? 'HDR 导出按参考白和交付峰值映射；实际亮度取决于播放器与屏幕。' : '普通 JPEG、PNG 和 WebP 使用 SDR 色调映射，保留高光层次。' }}
            AI 使用 SDR 参考图；重绘区域按参考白合成。
          </p>
        </div>
        <USwitch
          v-if="exifAvailable"
          v-model="keepExif"
          label="保留 EXIF 信息"
          :description="meta?.raw ? '拍摄时间、位置、相机和镜头、拍摄参数（从 RAW 原件读取）' : '相机型号、拍摄参数等（方向会重置为正常）'"
          :disabled="exporting"
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
      <DialogActions
        confirm-label="导出"
        confirm-icon="i-lucide-download"
        :loading="exporting || upgrading"
        @confirm="start"
        @cancel="open = false"
      />
    </template>
  </UModal>
</template>
