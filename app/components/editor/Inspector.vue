<script setup lang="ts">
import { RAW_BASE_ID, useEditorStore } from '~/stores/editor'
import { useInpaintStore } from '~/stores/inpaint'

const editor = useEditorStore()
const inpaint = useInpaintStore()
const layer = computed(() => editor.selectedLayer)

/** 重绘图层生成中或已有结果时锁定区域，避免结果与区域不一致 */
const regionLocked = computed(() => {
  const current = layer.value
  return !!current && current.kind === 'generative' && (!!current.result || inpaint.isRunning(current.id))
})

/** 检查器当前展示的对象；它变化时内容淡入，提示「这是另一个对象了」 */
const subject = computed(() => editor.tool === 'crop' ? 'crop' : editor.selectedLayerId === RAW_BASE_ID ? RAW_BASE_ID : layer.value?.id ?? 'empty')

function unlockRegion() {
  if (layer.value?.kind === 'generative') {
    editor.setGenerativeResult(layer.value.id, null)
  }
}
</script>

<template>
  <Transition name="swap">
    <div
      :key="subject"
      class="space-y-5"
    >
      <template v-if="editor.tool === 'crop'">
        <h3 class="panel-title">
          裁剪与校正
        </h3>
        <EditorCropPanel />
      </template>

      <EditorRawPanel v-else-if="subject === RAW_BASE_ID" />

      <template v-else-if="layer">
        <div class="space-y-1">
          <h3 class="panel-title truncate">
            {{ layer.name }}
          </h3>
          <p
            v-if="layer.reason"
            class="text-xs/relaxed text-muted"
          >
            {{ layer.reason }}
          </p>
        </div>

        <Transition name="reveal">
          <UAlert
            v-if="regionLocked && layer.kind === 'generative' && layer.result"
            color="neutral"
            variant="subtle"
            icon="i-lucide-lock"
            title="区域已锁定"
            description="区域与已生成的结果绑定。如需修改区域，请先移除结果。"
            :actions="[{ label: '移除结果并编辑区域', color: 'neutral', variant: 'outline', onClick: unlockRegion, size: 'lg' }]"
          />
        </Transition>

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
  </Transition>
</template>
