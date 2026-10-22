<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { isDesktop, pickImagePath, readFileAs } from '~/lib/desktop'
import { baseName, formatFromPath } from '~/lib/image/export-options'
import { IMAGE_ACCEPT, IMPORT_EXTENSIONS, isRawFile } from '~/lib/image/import-formats'
import { groupByAlbum, SORT_MODES, VIEW_MODES } from '~/lib/library/order'
import { createProject, type ProjectSummary } from '~/lib/storage/db'
import { useLibraryStore } from '~/stores/library'

/**
 * 工程列表页：图库页列出全部工程，相册页只列出该相册的工程；在相册页导入的照片直接放进这个相册。
 * 图库页还能切换展示方式：全部工程一个网格，或按相册分组（每个相册一组，没放进相册的收在最后）。
 * 页面自定义标题区（相册重命名）和标题栏右侧的额外操作（相册菜单），导入、排序、展示方式和删除确认在这里统一处理；
 * 卡片网格、拖放与移动见 LibraryProjectGrid。
 */
const props = defineProps<{
  id: string
  title: string
  /** 不传时是整个图库 */
  albumId?: string
}>()

defineSlots<{
  title?: () => unknown
  actions?: () => unknown
}>()

const library = useLibraryStore()
const notify = useNotify()
const router = useRouter()
const backdrop = useBackdrop()
const drag = useProjectDrag()

const importing = ref(false)
const importLabel = ref('正在导入照片…')
const importIsRaw = ref(false)
const importTitle = computed(() => importIsRaw.value ? '正在解码 RAW' : '正在导入照片')
const importDescription = computed(() => importIsRaw.value
  ? '较大的照片需要一些时间，请保持此页面打开。'
  : '正在准备照片，请稍候。')
let importController: AbortController | null = null
onBeforeUnmount(() => importController?.abort())
const file = ref<File | null>(null)
const pendingDelete = ref<ProjectSummary | null>(null)
const uploadRef = ref<{ inputRef: HTMLInputElement | undefined } | null>(null)

const projects = computed(() => library.sortedProjectsIn(props.albumId ?? null))

/** 分组只在图库页有意义（相册页本身就是一个相册），而且至少有一个相册、有工程时才提供切换 */
const canGroup = computed(() => !props.albumId && library.albums.length > 0 && projects.value.length > 0)
const grouped = computed(() => canGroup.value && library.viewMode === 'albums')
/** 先按排序方式排好再分组，每一组里就是同样的排序 */
const groups = computed(() => groupByAlbum(projects.value, library.albums))

const viewItems = VIEW_MODES.map(({ value, label, icon }) => ({ value, label, icon }))

// 侧栏透出这里最近修过的那张照片（与排序方式无关）；空相册沿用图库最近的照片，侧栏不会突然褪成纯灰
watchEffect(() => {
  if (library.loaded) {
    backdrop.value = (library.projectsIn(props.albumId ?? null)[0] ?? library.projects[0])?.thumbnail ?? null
  }
})

const sortLabel = computed(() => SORT_MODES.find(mode => mode.value === library.sortMode)?.label)

const sortMenu = computed<DropdownMenuItem[]>(() => SORT_MODES.map(mode => ({
  label: mode.label,
  type: 'checkbox',
  checked: library.sortMode === mode.value,
  onSelect: () => {
    library.sortMode = mode.value
  }
})))

/** filePath：桌面版从文件对话框导入时的原图位置，「保存」把结果写回这里；拖入与网页版没有 */
async function importPhoto(photo: File, filePath?: string) {
  if (importing.value) return
  importing.value = true
  importIsRaw.value = isRawFile(photo.name)
  importLabel.value = importIsRaw.value ? '正在解码 RAW，较大的照片需要一些时间…' : '正在导入照片…'
  importController = new AbortController()
  try {
    const id = await createProject(photo, props.albumId, filePath, importController.signal)
    if (isRawFile(photo.name)) {
      notify.info('RAW 已导入', '原文件已保留，使用浮点 HDR 底图调色。可导出 Ultra HDR JPEG、HDR PNG 或 EXR。')
    }
    await router.push(`/editor/${id}`)
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) notify.error(err)
  } finally {
    importing.value = false
    importIsRaw.value = false
    importController = null
  }
}

watch(file, async (selected) => {
  if (selected) {
    await importPhoto(selected)
    file.value = null
  }
})

/**
 * 桌面版：网页的文件选择框拿不到路径，改用系统「打开」对话框。
 * 点击拖放区、按键盘和「导入照片」按钮最终都是点这个 input，在它上面统一拦截（拖入的文件仍走上面的 watch，没有路径）。
 */
async function importFromDisk() {
  try {
    if (importing.value) return
    const path = await pickImagePath({ name: '照片', extensions: IMPORT_EXTENSIONS })
    if (path) {
      await importPhoto(await readFileAs(path, baseName(path), formatFromPath(path) ?? ''), path)
    }
  } catch (err) {
    notify.error(err)
  }
}

function interceptPick(event: Event) {
  event.preventDefault()
  void importFromDisk()
}

// input 随拖放区一起渲染：出现（或被重建）时挂上拦截
watch(() => uploadRef.value?.inputRef, (input, previous) => {
  previous?.removeEventListener('click', interceptPick)
  if (isDesktop()) {
    input?.addEventListener('click', interceptPick)
  }
}, { immediate: true, flush: 'post' })

async function confirmDelete() {
  const target = pendingDelete.value
  if (!target) {
    return
  }
  try {
    // 只从列表中移除这一项：卡片原地淡出、其余卡片让位，不整表刷新
    await library.removeProject(target.id)
    pendingDelete.value = null
  } catch (err) {
    notify.error(err)
  }
}
</script>

<template>
  <UDashboardPanel
    :id="id"
    :ui="{ root: 'bg-deep', body: 'gap-8 sm:gap-8' }"
  >
    <template #header>
      <UDashboardNavbar :title="title">
        <template
          v-if="$slots.title"
          #title
        >
          <slot name="title" />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-image-plus"
            label="导入照片"
            :loading="importing"
            @click="uploadRef?.inputRef?.click()"
          />
          <slot name="actions" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <UFileUpload
          ref="uploadRef"
          v-model="file"
          :accept="IMAGE_ACCEPT"
          :disabled="importing"
          :file-delete="!importing"
          :file-image="!file || !isRawFile(file.name)"
          :dropzone="!drag.dragging.value"
          icon="i-lucide-image-plus"
          label="拖入照片，或点击选择"
          description="支持 JPEG、PNG、WebP 和相机 RAW（兼容性因机型而异）。照片只存在这台设备上，用到 AI 时才会上传。"
          class="w-full"
          :class="projects.length ? 'min-h-36' : 'min-h-56'"
          :ui="{
            base: 'rounded-xl border-dashed border-accented bg-transparent duration-200 hover:bg-elevated data-[dragging=true]:bg-(--mac-selected)',
            icon: 'text-muted',
            label: 'text-highlighted',
            description: 'max-w-xl text-balance text-muted'
          }"
        />

        <UModal
          :open="importing"
          :title="importTitle"
          :description="importDescription"
          :close="false"
          :dismissible="false"
          :ui="{ content: 'max-w-md' }"
        >
          <template #body>
            <div class="space-y-4">
              <div class="flex items-start gap-3">
                <UIcon
                  name="i-lucide-loader-circle"
                  class="mt-0.5 size-5 shrink-0 animate-spin text-primary"
                  aria-hidden="true"
                />
                <p
                  role="status"
                  aria-live="polite"
                  class="text-sm text-muted"
                >
                  {{ importLabel }}
                </p>
              </div>
              <UProgress
                :model-value="null"
                animation="carousel"
                size="sm"
                aria-label="导入进度"
              />
            </div>
          </template>
          <template #footer>
            <div class="flex justify-end">
              <UButton
                label="取消导入"
                color="neutral"
                variant="ghost"
                @click="importController?.abort()"
              />
            </div>
          </template>
        </UModal>

        <!-- 图库为空时拖放区就是唯一的入口，不再重复一个「还没有工程」；空相册说明怎样把已有工程放进来（在相册里导入的照片会直接放进相册） -->
        <section
          v-if="!library.loaded || projects.length || albumId"
          aria-labelledby="recent-heading"
          class="flex flex-col gap-4"
        >
          <div class="flex items-center justify-between gap-3">
            <h2
              id="recent-heading"
              class="section-title"
            >
              {{ library.sortMode === 'recent' ? '最近的工程' : '工程' }}
            </h2>
            <div
              v-if="canGroup || projects.length > 1"
              class="flex flex-wrap items-center justify-end gap-3"
            >
              <p
                v-if="projects.length > 1 && library.sortMode === 'manual'"
                class="text-sm text-muted"
              >
                拖动卡片调整顺序
              </p>
              <!-- 切换视图的分段控件，样式与编辑器左栏的「AI 建议 / 图层」一致；没有内容面板，只负责切换 -->
              <UTabs
                v-if="canGroup"
                v-model="library.viewMode"
                role="group"
                aria-label="展示方式"
                :items="viewItems"
                :content="false"
                variant="pill"
                color="neutral"
                size="lg"
                :ui="{
                  list: 'rounded-lg bg-transparent p-0.5 ring ring-default ring-inset',
                  indicator: 'rounded-md bg-surface shadow-none ring ring-default',
                  trigger: 'data-[state=active]:text-highlighted'
                }"
              />
              <UDropdownMenu
                v-if="projects.length > 1"
                :items="sortMenu"
                :content="{ align: 'end' }"
              >
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-arrow-up-down"
                  trailing-icon="i-lucide-chevron-down"
                  :label="`排序：${sortLabel}`"
                />
              </UDropdownMenu>
            </div>
          </div>
          <div
            v-if="!library.loaded"
            class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
          >
            <div
              v-for="i in 4"
              :key="i"
              class="aspect-4/3 rounded-xl border border-default bg-default"
            />
          </div>
          <UEmpty
            v-else-if="projects.length === 0"
            icon="i-lucide-folder-open"
            title="相册里还没有工程"
            description="在图库里打开工程卡片的「更多操作」，可以把已有的工程移到这个相册。"
          />
          <LibraryProjectGrid
            v-else-if="!grouped"
            :projects="projects"
            @remove="pendingDelete = $event"
          />
          <!-- 按相册分组：相册按侧栏里的顺序，没放进相册的收在最后；标题点进去是该相册的页面 -->
          <div
            v-else
            class="flex flex-col gap-8"
          >
            <section
              v-for="group in groups"
              :key="group.album?.id ?? 'loose'"
              :aria-labelledby="`group-${group.album?.id ?? 'loose'}`"
              class="flex flex-col gap-3"
            >
              <div class="flex items-center gap-2">
                <h3
                  :id="`group-${group.album?.id ?? 'loose'}`"
                  class="min-w-0 text-sm font-semibold text-highlighted"
                >
                  <NuxtLink
                    v-if="group.album"
                    :to="`/albums/${group.album.id}`"
                    class="-ms-1.5 flex items-center gap-2 rounded-md px-1.5 py-0.5 outline-primary/60 transition-colors duration-200 ease-out hover:bg-elevated focus-visible:outline-2"
                  >
                    <LibraryAlbumEmoji
                      v-if="group.album.emoji"
                      :emoji="group.album.emoji"
                    />
                    <UIcon
                      v-else
                      name="i-lucide-folder"
                      class="size-4 shrink-0 text-muted"
                    />
                    <span class="truncate">{{ group.album.name }}</span>
                    <UIcon
                      name="i-lucide-chevron-right"
                      class="size-4 shrink-0 text-muted"
                    />
                  </NuxtLink>
                  <span
                    v-else
                    class="flex items-center gap-2"
                  >
                    <UIcon
                      name="i-lucide-image"
                      class="size-4 shrink-0 text-muted"
                    />
                    未放入相册
                  </span>
                </h3>
                <span class="shrink-0 text-xs text-muted tabular-nums">{{ group.projects.length }}</span>
              </div>
              <LibraryProjectGrid
                :projects="group.projects"
                :album-id="group.album?.id ?? null"
                @remove="pendingDelete = $event"
              />
            </section>
          </div>
        </section>
      </div>
      <UModal
        :open="!!pendingDelete"
        title="删除工程"
        :description="`确定删除「${pendingDelete?.name ?? ''}」吗？原图与所有修改都会从本机删除，无法恢复。`"
        @update:open="value => { if (!value) pendingDelete = null }"
      >
        <template #footer>
          <DialogActions
            confirm-label="删除"
            danger
            @confirm="confirmDelete"
            @cancel="pendingDelete = null"
          />
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
