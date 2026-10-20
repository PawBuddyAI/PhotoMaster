import type { ProjectSummary } from '~/lib/storage/db'
import { useLibraryStore } from '~/stores/library'

/** 拖动工程卡片时放进拖放数据的类型；从系统拖入照片文件不带它，两种拖放互不干扰 */
const PROJECT_DRAG_TYPE = 'application/x-apm-project'

/** 侧栏「图库」一行在放下目标里的标识（相册用自己的 id） */
const LIBRARY_TARGET = 'library'

/**
 * 工程卡片的拖放：卡片网格是拖动的起点，侧栏的「图库」与各相册是放下的目标（移到该相册 / 移出相册）。
 * 拖动在整个窗口里只会有一个，状态用 useState 共享，网格与侧栏据此判断是否接受放下；
 * 网格里卡片之间的排序是网格自己的事，见 LibraryPanel。
 */
export function useProjectDrag() {
  const library = useLibraryStore()
  const notify = useNotify()
  /** 正在被拖动的工程 id */
  const dragging = useState<string | null>('project-dragging', () => null)
  /** 拖动图像生成之后才淡化原卡片，否则拖动图像本身也是淡的 */
  const lifted = useState('project-lifted', () => false)
  /** 光标正停在哪个放下目标上（相册 id 或 LIBRARY_TARGET），侧栏据此描边 */
  const hovering = useState<string | null>('project-drop-target', () => null)

  function begin(event: DragEvent, project: ProjectSummary) {
    if (!event.dataTransfer) {
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(PROJECT_DRAG_TYPE, project.id)
    dragging.value = project.id
    setTimeout(() => {
      lifted.value = dragging.value === project.id
    })
  }

  function finish() {
    dragging.value = null
    lifted.value = false
    hovering.value = null
  }

  /** 移到相册，albumId 为 null 时移出所在相册；卡片菜单与拖放共用 */
  async function move(project: ProjectSummary, albumId: string | null) {
    try {
      await library.moveProject(project.id, albumId)
      const target = albumId ? library.findAlbum(albumId) : null
      notify.success(target ? `已移到相册「${target.name}」` : '已移出相册', project.name)
    } catch (err) {
      notify.error(err)
    }
  }

  /** 正在拖动的工程放进这个相册（albumId 为 null 是移出相册）会不会有变化 */
  function accepts(albumId: string | null): boolean {
    const project = dragging.value ? library.projects.find(item => item.id === dragging.value) : undefined
    return !!project && (project.albumId ?? null) !== albumId
  }

  /**
   * 侧栏一行作为放下目标要绑的事件。dragleave 会在光标进出该行的子元素时反复触发，
   * 只有真正离开整行（relatedTarget 不在行内）才取消描边
   */
  function dropTarget(albumId: string | null) {
    const key = albumId ?? LIBRARY_TARGET
    function accept(event: DragEvent) {
      if (!accepts(albumId)) {
        return
      }
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
      hovering.value = key
    }
    return {
      onDragenter: accept,
      onDragover: accept,
      onDragleave(event: DragEvent) {
        if (hovering.value === key && !(event.currentTarget as Node).contains(event.relatedTarget as Node | null)) {
          hovering.value = null
        }
      },
      onDrop(event: DragEvent) {
        event.preventDefault()
        const project = library.projects.find(item => item.id === dragging.value)
        finish()
        if (project && (project.albumId ?? null) !== albumId) {
          void move(project, albumId)
        }
      }
    }
  }

  function isDropping(albumId: string | null): boolean {
    return hovering.value === (albumId ?? LIBRARY_TARGET)
  }

  return { dragging, lifted, begin, finish, move, dropTarget, isDropping }
}
