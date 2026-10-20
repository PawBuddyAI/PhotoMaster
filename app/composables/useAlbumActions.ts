import type { DropdownMenuItem } from '@nuxt/ui'
import { useLibraryStore } from '~/stores/library'

/** 就地重命名的位置：相册页的标题栏，或侧栏里相册的那一行 */
export type AlbumRenamePlace = 'title' | 'sidebar'

export interface AlbumRenameDraft {
  id: string
  place: AlbumRenamePlace
  name: string
}

/**
 * 相册的整理操作，侧栏的右键菜单与相册页的「相册操作」共用一份菜单。
 * 重命名从哪里发起就在哪里就地输入；更换图标与删除确认弹窗由外壳里的 LibraryAlbumDialogs 统一渲染，这里只记下目标相册
 */
export function useAlbumActions() {
  const library = useLibraryStore()
  const notify = useNotify()
  const renaming = useState<AlbumRenameDraft | null>('album-renaming', () => null)
  /** 正在更换图标的相册 id */
  const pickingEmoji = useState<string | null>('album-picking-emoji', () => null)
  /** 等待确认删除的相册 id */
  const deleting = useState<string | null>('album-deleting', () => null)

  function menu(id: string, place: AlbumRenamePlace): DropdownMenuItem[][] {
    return [
      [{
        label: '重命名相册',
        icon: 'i-lucide-pencil',
        onSelect: () => {
          renaming.value = { id, place, name: library.findAlbum(id)?.name ?? '' }
        }
      }, {
        label: '更换图标',
        icon: 'i-lucide-smile',
        onSelect: () => {
          pickingEmoji.value = id
        }
      }],
      [{
        label: '删除相册',
        icon: 'i-lucide-trash-2',
        color: 'error',
        onSelect: () => {
          deleting.value = id
        }
      }]
    ]
  }

  /** 是否正在这个位置重命名这个相册 */
  function isRenaming(id: string, place: AlbumRenamePlace): boolean {
    return renaming.value?.id === id && renaming.value.place === place
  }

  /** 回车与失焦都会提交：先清空草稿，输入框卸载时再触发的失焦就不会重复写入 */
  async function commitRename(): Promise<void> {
    const draft = renaming.value
    renaming.value = null
    if (!draft) {
      return
    }
    try {
      await library.renameAlbum(draft.id, draft.name)
    } catch (err) {
      notify.error(err)
    }
  }

  return { renaming, pickingEmoji, deleting, menu, isRenaming, commitRename }
}
