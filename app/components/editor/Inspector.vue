<script setup lang="ts">
import { useEditorStore } from '~/stores/editor'
import { useInpaintStore } from '~/stores/inpaint'

const editor = useEditorStore()
const inpaint = useInpaintStore()
const layer = computed(() => editor.selectedLayer)

/** 重绘图层生成中或已有结果时锁定区域，避免结果与区域不一致 */
const regionLocked = computed(() => {
  const current = layer.value
  return !!current && current.kind === 'generative' && (!!current.result || inpaint.isRunning(current.id))
})

function unlockRegion() {
  if (layer.value?.kind === 'generative') {
    editor.setGenerativeResult(layer.value.id, null)
  }
}
</script>

<template>
  <div class="space-y-5">
    <template v-if="editor.tool === 'crop'">
      <p class="text-sm font-semibold">
        裁剪与校正
      </p>
      <EditorCropPanel />
    </template>

    <template v-else-if="layer">
      <div class="space-y-1">
        <p class="truncate text-sm font-semibold">
          {{ layer.name }}
        </p>
        <p
          v-if="layer.reason"
          class="text-xs text-muted"
        >
          {{ layer.reason }}
        </p>
      </div>

      <UAlert
        v-if="regionLocked && layer.kind === 'generative' && layer.result"
        color="neutral"
        variant="subtle"
        icon="i-lucide-lock"
        title="区域已锁定"
        description="区域与已生成的结果绑定。如需修改区域，请先移除结果。"
        :actions="[{ label: '移除结果并编辑区域', color: 'neutral', variant: 'link', onClick: unlockRegion, size: 'lg' }]"
      />

      <EditorRegionTools
        :layer="layer"
        :locked="regionLocked"
      />
      <USeparator />
      <EditorAdjustPanel
        v-if="layer.kind === 'adjust'"
        :layer="layer"
      />
      <EditorGenerativePanel
        v-else
        :layer="layer"
      />
    </template>

    <UEmpty
      v-else
      icon="i-lucide-mouse-pointer-click"
      title="未选择图层"
      description="在左侧选择或新建一个图层后，可在这里调整参数和区域"
      size="sm"
    />
  </div>
</template>
