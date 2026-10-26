import { z } from 'zod'

/**
 * 桌面版安装包的发布清单（latest.json）：发布脚本 scripts/release.ts 生成并校验，网页版读取它来决定要不要展示下载入口。
 * 浏览器与 Node（CI 直接运行脚本）共用，只放不依赖 Nuxt 自动导入和 Node 内置模块的内容。
 * 固定的 ASCII 文件名让 releases/latest/download/ 的地址不随版本变化，也避开产品名里的中文和空格。
 */
/** 源代码与桌面版 Release 所在的 GitHub 仓库：设置页「关于」链到这里，Pages 构建时从它的最新 Release 取安装包 */
export const GITHUB_REPO = 'PawBuddyAI/PhotoMaster'
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`

export const INSTALLER_NAME = 'ai-photo-master-setup.exe'
export const MANIFEST_NAME = 'latest.json'

/** 站点里安装包与清单所在的目录，由 Pages 构建时的 scripts/release.ts fetch 放入 */
const SITE_DOWNLOAD_DIR = '/download'
export const SITE_INSTALLER_URL = `${SITE_DOWNLOAD_DIR}/${INSTALLER_NAME}`

export const manifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  file: z.literal(INSTALLER_NAME),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive(),
  date: z.iso.datetime()
})

export type ReleaseManifest = z.infer<typeof manifestSchema>

/**
 * 读取站点上的最新发布清单。还没发布过桌面版时站点没有 /download/：
 * 开发服务器与 Pages 会把未知路径回退成 index.html（状态码 200），所以必须解析并校验内容；
 * 网络错误、状态码不对、不是 JSON、格式不符都返回 null——界面据此不展示入口，而不是放一个打不开的链接。
 */
export async function loadSiteRelease(fetchImpl: typeof fetch = globalThis.fetch): Promise<ReleaseManifest | null> {
  try {
    const response = await fetchImpl(`${SITE_DOWNLOAD_DIR}/${MANIFEST_NAME}`, { cache: 'no-cache' })
    if (!response.ok) {
      return null
    }
    const parsed = manifestSchema.safeParse(await response.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** 安装包大小，例如 8.6 MB（与 fetch 日志一样按 1024 进位） */
export function formatInstallerSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
