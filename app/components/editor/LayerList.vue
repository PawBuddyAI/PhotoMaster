<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
import { pinLeaving } from '~/lib/motion'
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

/**
 * 右键菜单关闭时焦点默认回到右键前的位置。选了「重命名」时输入框已经自动聚焦，
 * 不能再把焦点拿走，否则输入框刚出现就失焦，失焦即提交
 */
function onMenuCloseAutoFocus(event: Event) {
  if (editingId.value) {
    event.preventDefault()
  }
}

/** 右键菜单：行内按钮的全部操作加上重命名；已在最上、最下的图层不能再上移、下移 */
function layerMenu(layer: Layer): ContextMenuItem[][] {
  const index = editor.layers.findIndex(l => l.id === layer.id)
  return [
    [{
      label: layer.enabled ? '隐藏图层' : '显示图层',
      icon: layer.enabled ? 'i-lucide-eye-off' : 'i-lucide-eye',
      onSelect: () => editor.toggleLayer(layer.id)
    }, {
      label: '重命名',
      icon: 'i-lucide-pencil',
      onSelect: () => startRename(layer)
    }],
    [{
      label: '上移',
      icon: 'i-lucide-chevron-up',
      disabled: index === editor.layers.length - 1,
      onSelect: () => editor.moveLayer(layer.id, 1)
    }, {
      label: '下移',
      icon: 'i-lucide-chevron-down',
      disabled: index === 0,
      onSelect: () => editor.moveLayer(layer.id, -1)
    }],
    [{
      label: '删除图层',
      icon: 'i-lucide-trash-2',
      color: 'error',
      onSelect: () => editor.removeLayer(layer.id)
    }]
  ]
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

    <!-- 上移、下移、增删和撤销重做时其余图层平滑让位，叠放顺序的变化看得见 -->
    <TransitionGroup
      v-else
      tag="ul"
      name="list"
      class="relative space-y-1"
      @before-leave="pinLeaving"
    >
      <!-- li 是过渡的直接子元素，右键菜单放在里面，行的外观与交互挂在触发元素上 -->
      <li
        v-for="layer in displayLayers"
        :key="layer.id"
      >
        <UContextMenu
          :items="layerMenu(layer)"
          :content="{ onCloseAutoFocus: onMenuCloseAutoFocus }"
        >
          <div
            tabindex="0"
            :aria-current="layer.id === editor.selectedLayerId ? 'true' : undefined"
            class="group flex items-center gap-2 rounded-lg px-2 py-1.5 outline-primary/60 transition-colors duration-200 ease-out focus-visible:outline-2 data-[state=open]:outline-2 data-[state=open]:outline-primary"
            :class="layer.id === editor.selectedLayerId ? 'bg-(--mac-selected)' : 'hover:bg-elevated'"
            @click="editor.selectedLayerId = layer.id"
            @contextmenu="editor.selectedLayerId = layer.id"
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
                aria-label="图层名称"
                class="w-full"
                @keydown.enter="finishRename"
                @keydown.esc="editingId = null"
                @blur="finishRename"
                @click.stop
                @contextmenu.stop
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
          </div>
        </UContextMenu>
      </li>
    </TransitionGroup>
    <p
      v-if="displayLayers.length"
      class="text-xs text-muted"
    >
      双击图层名可重命名，右键图层可显示更多操作；重绘图层先于调整图层合成，调色可随时修改而不必重新生成。
    </p>
  </div>
</template>
