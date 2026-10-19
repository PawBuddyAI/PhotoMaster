<script setup lang="ts">
import { useEditorStore, type EditorTool } from '~/stores/editor'
import { useInpaintStore } from '~/stores/inpaint'
import { useLibraryStore } from '~/stores/library'

definePageMeta({ layout: false })

const route = useRoute()
const router = useRouter()
const library = useLibraryStore()
const editor = useEditorStore()
const inpaint = useInpaintStore()
const assets = useProjectAssets()
const view = useEditorRenderer()
const notify = useNotify()
const backdrop = useBackdrop()

const canvasRef = ref<{ fit: () => void, zoomBy: (f: number) => void, actualSize: () => void } | null>(null)
const loadError = ref<string | null>(null)
const exportOpen = ref(false)
const leftTab = ref('suggest')

const projectId = computed(() => String(route.params.id))

/** 进入编辑器前所在的页面（vue-router 记在历史状态里）；直接打开链接时没有 */
const cameFrom = router.options.history.state.back
/** 返回入口：从相册进来时回到那个相册，其余情况回到图库。刷新编辑器页后外壳没有读取过图库、找不到相册，也回到图库 */
const back = computed(() => {
  const albumId = typeof cameFrom === 'string' ? /^\/albums\/([^/?#]+)/.exec(cameFrom)?.[1] : undefined
  const album = albumId ? library.findAlbum(decodeURIComponent(albumId)) : undefined
  return album
    ? { to: `/albums/${album.id}`, label: album.name, ariaLabel: `返回相册「${album.name}」` }
    : { to: '/', label: '图库', ariaLabel: '返回图库' }
})

const SAVE_LABELS = {
  saved: '已保存',
  dirty: '未保存',
  saving: '保存中…',
  error: '保存失败'
} as const

const tools: Array<{ value: EditorTool, label: string, icon: string, key: string }> = [
  { value: 'move', label: '选择 / 平移', icon: 'i-lucide-mouse-pointer-2', key: 'V' },
  { value: 'brush', label: '画笔添加区域', icon: 'i-lucide-brush', key: 'B' },
  { value: 'erase', label: '画笔擦除区域', icon: 'i-lucide-eraser', key: 'E' },
  { value: 'crop', label: '裁剪与校正', icon: 'i-lucide-crop', key: 'C' }
]

// 侧栏透出当前工程的照片；从工程列表进来时由上一张照片的色调溶解过来
watch(() => editor.project?.thumbnail, (thumbnail) => {
  if (thumbnail) {
    backdrop.value = thumbnail
  }
}, { immediate: true })

onMounted(async () => {
  try {
    await editor.open(projectId.value)
    await assets.load(projectId.value, editor.project!.originalBlobId)
    view.init()
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  }
  window.addEventListener('keydown', onShortcut)
  window.addEventListener('keyup', onShortcutUp)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onShortcut)
  window.removeEventListener('keyup', onShortcutUp)
  inpaint.discardAll()
  void editor.close().catch(err => notify.error(err))
  assets.release()
})

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

function onShortcut(e: KeyboardEvent) {
  if (isTyping(e.target)) {
    return
  }
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.toLowerCase()
  if (mod && key === 'z') {
    e.preventDefault()
    if (e.shiftKey) editor.redo()
    else editor.undo()
    return
  }
  if (mod && key === 'y') {
    e.preventDefault()
    editor.redo()
    return
  }
  if (mod && key === 's') {
    e.preventDefault()
    void editor.flush().catch(err => notify.error(err))
    return
  }
  if (mod || e.altKey) {
    return
  }
  const tool = tools.find(t => t.key.toLowerCase() === key)
  if (tool) {
    editor.tool = tool.value
  } else if (key === '[') {
    editor.brush.radius = Math.max(0.002, editor.brush.radius / 1.2)
  } else if (key === ']') {
    editor.brush.radius = Math.min(0.2, editor.brush.radius * 1.2)
  } else if (key === '\\') {
    editor.compareOriginal = true
  } else if (key === '0') {
    canvasRef.value?.fit()
  } else if (key === 'escape' && editor.tool !== 'move') {
    editor.tool = 'move'
  }
}

function onShortcutUp(e: KeyboardEvent) {
  if (e.key === '\\') {
    editor.compareOriginal = false
  }
}
</script>

<template>
  <div
    v-if="loadError"
    class="flex min-h-screen flex-col items-center justify-center gap-4 bg-deep p-6"
  >
    <UEmpty
      icon="i-lucide-image-off"
      title="无法打开工程"
      :description="loadError"
    />
    <UButton
      :to="back.to"
      icon="i-lucide-arrow-left"
      :label="back.ariaLabel"
      color="neutral"
      variant="outline"
    />
  </div>

  <UDashboardGroup
    v-else
    unit="rem"
    storage="local"
    storage-key="apm-editor"
  >
    <UDashboardSidebar
      id="editor-left"
      :default-size="21"
      :min-size="16"
      :max-size="32"
      resizable
      :ui="{ body: 'gap-0' }"
    >
      <template #header>
        <UButton
          :to="back.to"
          icon="i-lucide-chevron-left"
          :label="back.label"
          color="neutral"
          variant="ghost"
          :aria-label="back.ariaLabel"
          class="-ms-2 min-w-0"
        />
      </template>
      <UTabs
        v-model="leftTab"
        :items="[
          { label: 'AI 建议', value: 'suggest', icon: 'i-lucide-sparkles', slot: 'suggest' as const },
          { label: '图层', value: 'layers', icon: 'i-lucide-layers', slot: 'layers' as const }
        ]"
        variant="pill"
        color="neutral"
        size="lg"
        class="w-full"
        :ui="{
          list: 'rounded-lg bg-transparent p-0.5 ring ring-default ring-inset',
          indicator: 'rounded-md bg-surface shadow-none ring ring-default',
          trigger: 'data-[state=active]:text-highlighted'
        }"
      >
        <!-- 图层数每次变化都重新挂载并落定：采纳一条建议时，用户能看到它变成了「图层」里的一项 -->
        <template #trailing="{ item }">
          <UBadge
            v-if="item.value === 'layers' && editor.layers.length"
            :key="editor.layers.length"
            :label="String(editor.layers.length)"
            color="neutral"
            variant="soft"
            size="sm"
            class="shrink-0 tabular-nums motion-safe:animate-settle-in"
          />
        </template>
        <template #suggest>
          <div class="pt-3">
            <EditorSuggestionPanel :source="view.displayCanvas.value" />
          </div>
        </template>
        <template #layers>
          <div class="pt-3">
            <EditorLayerList />
          </div>
        </template>
      </UTabs>
    </UDashboardSidebar>

    <UDashboardPanel
      id="editor-canvas"
      :ui="{ body: 'p-0 sm:p-0 overflow-hidden' }"
    >
      <template #header>
        <UDashboardNavbar
          :title="editor.project?.name ?? ''"
          :toggle="false"
        >
          <template #leading>
            <UDashboardSidebarCollapse />
          </template>
          <template #right>
            <span
              class="hidden text-xs sm:inline"
              :class="editor.saveState === 'error' ? 'text-error' : 'text-dimmed'"
            >
              {{ SAVE_LABELS[editor.saveState] }}
            </span>
            <UTooltip
              text="撤销"
              :kbds="['ctrl', 'z']"
            >
              <UButton
                icon="i-lucide-undo-2"
                color="neutral"
                variant="ghost"
                :disabled="!editor.canUndo"
                aria-label="撤销"
                @click="editor.undo()"
              />
            </UTooltip>
            <UTooltip
              text="重做"
              :kbds="['ctrl', 'shift', 'z']"
            >
              <UButton
                icon="i-lucide-redo-2"
                color="neutral"
                variant="ghost"
                :disabled="!editor.canRedo"
                aria-label="重做"
                @click="editor.redo()"
              />
            </UTooltip>
            <UTooltip
              text="按住对比原图"
              :kbds="['\\']"
            >
              <UButton
                icon="i-lucide-split-square-horizontal"
                color="neutral"
                :variant="editor.compareOriginal ? 'soft' : 'ghost'"
                aria-label="对比原图"
                @pointerdown="editor.compareOriginal = true"
                @pointerup="editor.compareOriginal = false"
                @pointerleave="editor.compareOriginal = false"
              />
            </UTooltip>
            <UButton
              icon="i-lucide-download"
              label="导出"
              :disabled="!view.ready.value"
              @click="exportOpen = true"
            />
          </template>
        </UDashboardNavbar>
        <UDashboardToolbar>
          <template #left>
            <UFieldGroup>
              <UTooltip
                v-for="tool in tools"
                :key="tool.value"
                :text="tool.label"
                :kbds="[tool.key]"
              >
                <UButton
                  :icon="tool.icon"
                  :color="editor.tool === tool.value ? 'primary' : 'neutral'"
                  :variant="editor.tool === tool.value ? 'soft' : 'ghost'"
                  :aria-label="tool.label"
                  @click="editor.tool = tool.value"
                />
              </UTooltip>
            </UFieldGroup>
            <span
              v-if="editor.tool === 'brush' || editor.tool === 'erase'"
              class="text-xs text-muted"
            >
              {{ editor.selectedLayer ? `在「${editor.selectedLayer.name}」上${editor.tool === 'brush' ? '涂抹添加' : '涂抹擦除'}区域` : '请先选择一个图层' }}
            </span>
          </template>
          <template #right>
            <UTooltip text="缩小">
              <UButton
                icon="i-lucide-zoom-out"
                color="neutral"
                variant="ghost"
                aria-label="缩小"
                @click="canvasRef?.zoomBy(1 / 1.25)"
              />
            </UTooltip>
            <UTooltip
              text="适应窗口"
              :kbds="['0']"
            >
              <UButton
                icon="i-lucide-scan"
                color="neutral"
                variant="ghost"
                aria-label="适应窗口"
                @click="canvasRef?.fit()"
              />
            </UTooltip>
            <UTooltip text="原始像素">
              <UButton
                label="1:1"
                color="neutral"
                variant="ghost"
                @click="canvasRef?.actualSize()"
              />
            </UTooltip>
            <UTooltip text="放大">
              <UButton
                icon="i-lucide-zoom-in"
                color="neutral"
                variant="ghost"
                aria-label="放大"
                @click="canvasRef?.zoomBy(1.25)"
              />
            </UTooltip>
          </template>
        </UDashboardToolbar>
      </template>
      <template #body>
        <EditorCanvas
          ref="canvasRef"
          :view="view"
        />
      </template>
    </UDashboardPanel>

    <UDashboardSidebar
      id="editor-right"
      side="right"
      :default-size="19"
      :min-size="15"
      :max-size="28"
      resizable
    >
      <template #header>
        <h2 class="text-sm font-medium text-muted">
          属性
        </h2>
      </template>
      <EditorInspector />
    </UDashboardSidebar>

    <EditorExportModal v-model:open="exportOpen" />
  </UDashboardGroup>
</template>
