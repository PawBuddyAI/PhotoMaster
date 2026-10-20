<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { DropSide } from '~/lib/library/order'
import { pinLeaving } from '~/lib/motion'
import type { ProjectSummary } from '~/lib/storage/db'
import { useLibraryStore } from '~/stores/library'

/**
 * 一个工程卡片网格：整个图库、单个相册，或图库按相册分组时的一组。
 * 卡片可以拖：在网格里拖到另一张卡片的前后调整顺序；传了 albumId 的网格（分组视图里的每一组）
 * 还是放下目标，别的组拖来的工程放下后移进这一组的相册（「未放入相册」一组则是移出相册）。
 * 拖到侧栏相册上移动的放下目标在外壳里。删除要先确认，由页面弹窗处理，这里只发出 remove。
 */
const props = defineProps<{
  /** 按页面上看到的顺序 */
  projects: ProjectSummary[]
  /** 这一组对应的相册，null 是「未放入相册」；不传时只接受网格内的排序 */
  albumId?: string | null
}>()

const emit = defineEmits<{
  remove: [project: ProjectSummary]
}>()

const library = useLibraryStore()
const notify = useNotify()
const drag = useProjectDrag()

/** 已解码完成的缩略图：解码前只露出凹槽底色，完成后再淡入，网格不会逐张闪现 */
const decoded = ref(new Set<string>())

const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })

const inside = computed(() => new Set(props.projects.map(project => project.id)))

/** 拖动排序时光标停在哪张卡片的哪一侧：放下后被拖的工程排在它之前或之后 */
const hint = ref<{ id: string, side: DropSide } | null>(null)
/** 别的组拖来的工程正停在这个网格上，网格描一圈系统蓝 */
const receiving = ref(false)

// 拖动结束（包括按 Esc 取消）后清掉所有提示，不依赖 dragleave 一定触发
watch(drag.dragging, (id) => {
  if (!id) {
    hint.value = null
    receiving.value = false
  }
})

/** 正在拖的工程不在这个网格里，而这一组接受它（相册不同）时，放下会把它移进来 */
function takesOver(): boolean {
  const dragged = drag.dragging.value
  return props.albumId !== undefined && !!dragged && !inside.value.has(dragged) && drag.accepts(props.albumId)
}

function onDragOver(event: DragEvent) {
  const dragged = drag.dragging.value
  if (!dragged) {
    return
  }
  if (!inside.value.has(dragged)) {
    if (takesOver()) {
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
      receiving.value = true
    }
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  // 光标在卡片之间的空隙里时保持上一次的位置，指示线不会来回闪
  const card = (event.target as Element).closest<HTMLElement>('li[data-project]')
  if (!card) {
    return
  }
  if (card.dataset.project === dragged) {
    hint.value = null
    return
  }
  const rect = card.getBoundingClientRect()
  hint.value = { id: card.dataset.project!, side: event.clientX < rect.left + rect.width / 2 ? 'before' : 'after' }
}

function onDragLeave(event: DragEvent) {
  if (!(event.currentTarget as Node).contains(event.relatedTarget as Node | null)) {
    hint.value = null
    receiving.value = false
  }
}

async function onDrop(event: DragEvent) {
  event.preventDefault()
  const moved = drag.dragging.value
  const target = hint.value
  const incoming = takesOver() ? library.projects.find(project => project.id === moved) : undefined
  endDrag()
  if (incoming) {
    await drag.move(incoming, props.albumId ?? null)
    return
  }
  if (!moved || !target) {
    return
  }
  try {
    await library.reorderProject(moved, target.id, target.side, props.projects.map(project => project.id))
  } catch (err) {
    notify.error(err)
  }
}

function endDrag() {
  hint.value = null
  receiving.value = false
  drag.finish()
}

function cardMenu(project: ProjectSummary): DropdownMenuItem[][] {
  const targets = library.albums.filter(album => album.id !== project.albumId)
  const organize: DropdownMenuItem[] = [{
    label: '移到相册',
    icon: 'i-lucide-folder-input',
    children: targets.length
      // 有 emoji 的相册走 album 插槽，用 emoji 代替文件夹图标
      ? targets.map(album => ({ label: album.name, icon: 'i-lucide-folder', emoji: album.emoji, slot: album.emoji ? 'album' : undefined, onSelect: () => drag.move(project, album.id) }))
      : [{ label: library.albums.length ? '没有其他相册' : '还没有相册，可在侧栏新建', disabled: true }]
  }]
  if (project.albumId) {
    organize.push({ label: '移出相册', icon: 'i-lucide-folder-output', onSelect: () => drag.move(project, null) })
  }
  const remove: DropdownMenuItem = {
    label: '删除工程',
    icon: 'i-lucide-trash-2',
    color: 'error',
    onSelect: () => emit('remove', project)
  }
  return [organize, [remove]]
}
</script>

<template>
  <TransitionGroup
    tag="ul"
    name="list"
    class="relative grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
    :class="receiving ? 'rounded-xl outline-2 outline-offset-4 outline-primary' : ''"
    @before-leave="pinLeaving"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- li 是过渡的直接子元素，右键菜单只能放在里面：卡片外观挂在触发元素上，被右键的卡片才能描上蓝边 -->
    <li
      v-for="project in projects"
      :key="project.id"
      :data-project="project.id"
      class="relative min-w-0"
    >
      <!-- 拖动排序的插入位置：落在卡片之间的空隙里，系统蓝竖线 -->
      <span
        v-if="hint?.id === project.id"
        aria-hidden="true"
        class="pointer-events-none absolute inset-y-0 z-10 w-0.5 rounded-full bg-primary"
        :class="hint.side === 'before' ? '-left-2.25' : '-right-2.25'"
      />
      <UContextMenu :items="cardMenu(project)">
        <!-- 菜单项是运行时拼出来的，slot 名不是字面量，Nuxt UI 推断不出插槽参数的类型 -->
        <template #album-leading="{ item }">
          <LibraryAlbumEmoji :emoji="(item as DropdownMenuItem).emoji" />
        </template>
        <!-- 链接和图片自己也能被浏览器拖走，关掉它们的拖动，整张卡片才是拖动的对象 -->
        <div
          draggable="true"
          class="h-full overflow-hidden rounded-xl border border-default bg-default outline-primary transition-[background-color,border-color,opacity] duration-200 ease-out hover:border-accented hover:bg-(--mac-mid-hover) data-[state=open]:outline-2"
          :class="drag.lifted.value && drag.dragging.value === project.id ? 'opacity-50' : ''"
          @dragstart="drag.begin($event, project)"
          @dragend="endDrag"
        >
          <NuxtLink
            :to="`/editor/${project.id}`"
            class="block outline-primary/60 focus-visible:outline-2 focus-visible:-outline-offset-2"
            tabindex="-1"
            aria-hidden="true"
            draggable="false"
          >
            <img
              :src="library.thumbnails[project.id]"
              alt=""
              draggable="false"
              class="aspect-4/3 w-full border-b border-default bg-deep object-cover transition-opacity duration-300 ease-out"
              :class="decoded.has(project.id) ? 'opacity-100' : 'opacity-0'"
              @load="decoded.add(project.id)"
            >
          </NuxtLink>
          <div class="flex items-center justify-between gap-2 py-2 ps-3 pe-1.5">
            <NuxtLink
              :to="`/editor/${project.id}`"
              draggable="false"
              class="min-w-0 rounded-md outline-primary/60 focus-visible:outline-2"
            >
              <p class="truncate text-sm font-medium text-highlighted">{{ project.name }}</p>
              <p class="truncate text-xs text-muted tabular-nums">
                {{ project.width }}×{{ project.height }} · {{ dateFormat.format(project.updatedAt) }}
              </p>
            </NuxtLink>
            <UDropdownMenu
              :items="cardMenu(project)"
              :content="{ align: 'end' }"
            >
              <template #album-leading="{ item }">
                <LibraryAlbumEmoji :emoji="(item as DropdownMenuItem).emoji" />
              </template>
              <UButton
                icon="i-lucide-ellipsis"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="更多操作"
              />
            </UDropdownMenu>
          </div>
        </div>
      </UContextMenu>
    </li>
  </TransitionGroup>
</template>
