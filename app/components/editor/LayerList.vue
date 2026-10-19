<script setup lang="ts">
import type { Layer } from '~/lib/types'
import { useEditorStore } from '~/stores/editor'
import { useInpaintStore } from '~/stores/inpaint'

const editor = useEditorStore()
const inpaint = useInpaintStore()

/** 列表从上到下显示“最后施加 → 最先施加”，与图层叠放顺序一致 */
const displayLayers = computed(() => [...editor.layers].reverse())
const editingId = ref<string | null>(null)
const editingName = ref('')

function startRename(layer: Layer) {
  editingId.value = layer.id
  editingName.value = layer.name
}

function finishRename() {
  if (editingId.value) {
    editor.renameLayer(editingId.value, editingName.value)
  }
  editingId.value = null
}

function statusOf(layer: Layer): { label: string, color: 'neutral' | 'success' | 'warning' | 'info' } | null {
  if (layer.kind !== 'generative') {
    return null
  }
  if (inpaint.isRunning(layer.id)) {
    return { label: '生成中', color: 'info' }
  }
  if (inpaint.jobs[layer.id]?.candidates.length) {
    return { label: '待挑选', color: 'warning' }
  }
  return layer.result ? { label: '已生成', color: 'success' } : { label: '待生成', color: 'neutral' }
}
</script>

<template>
  <div class="space-y-3">
    <div class="grid grid-cols-2 gap-2">
      <UButton
        icon="i-lucide-sliders-horizontal"
        label="调整图层"
        color="neutral"
        variant="outline"
        block
        @click="editor.addAdjustmentLayer()"
      />
      <UButton
        icon="i-lucide-wand-sparkles"
        label="重绘区域"
        color="neutral"
        variant="outline"
        block
        @click="editor.addGenerativeLayer()"
      />
    </div>

    <UEmpty
      v-if="displayLayers.length === 0"
      icon="i-lucide-layers"
      title="还没有图层"
      description="新建调整图层手动调色，或在「AI 建议」中一键生成"
      size="sm"
    />

    <ul
      v-else
      class="space-y-1"
    >
      <li
        v-for="layer in displayLayers"
        :key="layer.id"
        tabindex="0"
        :aria-current="layer.id === editor.selectedLayerId ? 'true' : undefined"
        class="group flex items-center gap-2 rounded-lg px-2 py-1.5 outline-primary/60 transition-colors duration-200 ease-out focus-visible:outline-2"
        :class="layer.id === editor.selectedLayerId ? 'bg-(--mac-selected)' : 'hover:bg-elevated'"
        @click="editor.selectedLayerId = layer.id"
        @keydown.enter.self.prevent="editor.selectedLayerId = layer.id"
        @keydown.space.self.prevent="editor.selectedLayerId = layer.id"
      >
        <UIcon
          :name="layer.kind === 'adjust' ? 'i-lucide-sliders-horizontal' : 'i-lucide-wand-sparkles'"
          class="size-4 shrink-0"
          :class="!layer.enabled ? 'text-dimmed' : layer.id === editor.selectedLayerId ? 'text-primary' : 'text-muted'"
        />
        <div class="min-w-0 flex-1">
          <UInput
            v-if="editingId === layer.id"
            v-model="editingName"
            size="xs"
            autofocus
            class="w-full"
            @keydown.enter="finishRename"
            @keydown.esc="editingId = null"
            @blur="finishRename"
            @click.stop
          />
          <p
            v-else
            class="truncate text-sm"
            :class="layer.enabled ? 'text-highlighted' : 'text-muted line-through'"
            @dblclick.stop="startRename(layer)"
          >
            {{ layer.name }}
          </p>
          <div class="flex items-center gap-1">
            <UBadge
              v-if="layer.source === 'llm'"
              label="AI"
              icon="i-lucide-sparkles"
              size="sm"
              color="neutral"
              variant="subtle"
            />
            <UBadge
              v-if="statusOf(layer)"
              :label="statusOf(layer)!.label"
              size="sm"
              :color="statusOf(layer)!.color"
              variant="subtle"
            />
            <span
              v-if="layer.mask.shape !== 'full' || layer.mask.strokes.length"
              class="text-[11px] text-muted"
            >局部</span>
          </div>
        </div>
        <div class="flex shrink-0 items-center">
          <UButton
            :icon="layer.enabled ? 'i-lucide-eye' : 'i-lucide-eye-off'"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="layer.enabled ? '隐藏图层' : '显示图层'"
            @click.stop="editor.toggleLayer(layer.id)"
          />
          <UButton
            icon="i-lucide-chevron-up"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="上移"
            @click.stop="editor.moveLayer(layer.id, 1)"
          />
          <UButton
            icon="i-lucide-chevron-down"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="下移"
            @click.stop="editor.moveLayer(layer.id, -1)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="删除图层"
            @click.stop="editor.removeLayer(layer.id)"
          />
        </div>
      </li>
    </ul>
    <p
      v-if="displayLayers.length"
      class="text-xs text-muted"
    >
      双击图层名可重命名；重绘图层先于调整图层合成，调色可随时修改而不必重新生成。
    </p>
  </div>
</template>
