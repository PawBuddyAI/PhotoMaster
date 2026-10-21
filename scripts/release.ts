import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
// CI 用 node 直接运行本脚本（类型剥离），相对导入必须带 .ts 扩展名
import { INSTALLER_NAME, MANIFEST_NAME, manifestSchema, type ReleaseManifest } from '../app/lib/release.ts'

/**
 * 桌面版安装包的发布与取用。
 * 发布（GitHub Actions）：pack 把 NSIS 安装包整理成固定文件名 + 校验信息 latest.json，上传到 Release。
 * 取用（Cloudflare Pages 构建）：fetch 从最新 Release 下载并校验后放进站点的 /download/，国内用户从 Pages 下载。
 * 文件名与清单格式见 app/lib/release.ts，网页版的下载入口读取同一份清单。
 */
const DEFAULT_REPO = 'PawBuddyAI/PhotoMaster'

/**
 * 站点里 /download/ 对应的目录，须与 nuxt generate 的产物目录一致：
 * Cloudflare Pages 构建环境（CF_PAGES）下 Nitro 自动选 cloudflare-pages-static 预设，产物在 dist/，其余环境在 .output/public
 */
export function siteDownloadDir(env: Record<string, string | undefined> = process.env) {
  return env.CF_PAGES ? 'dist/download' : '.output/public/download'
}

export type FetchLike = (url: string) => Promise<Response>

export function releaseAssetUrl(repo: string, name: string) {
  return `https://github.com/${repo}/releases/latest/download/${name}`
}

export function sha256Hex(data: Uint8Array) {
  return createHash('sha256').update(data).digest('hex')
}

export async function packRelease(installerPath: string, outDir: string, version: string, now = new Date()) {
  const data = await readFile(installerPath)
  const manifest = manifestSchema.parse({
    version,
    file: INSTALLER_NAME,
    sha256: sha256Hex(data),
    size: data.byteLength,
    date: now.toISOString()
  })
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, INSTALLER_NAME), data)
  await writeFile(join(outDir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

interface RetryOptions {
  attempts: number
  delayMs: number
}

/** 404 表示文件不存在，返回 null；其他失败（含网络错误）按次数重试，仍失败则抛出 */
export async function download(url: string, fetchImpl: FetchLike, { attempts, delayMs }: RetryOptions) {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url)
      if (response.status === 404) {
        return null
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      return new Uint8Array(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt))
      }
    }
  }
  throw new Error(`下载失败：${url}（已尝试 ${attempts} 次）`, { cause: lastError })
}

export interface FetchReleaseOptions {
  repo?: string
  outDir?: string
  fetch?: FetchLike
  attempts?: number
  delayMs?: number
  log?: (message: string) => void
}

export type FetchReleaseResult = { status: 'skipped' } | { status: 'fetched', manifest: ReleaseManifest }

/**
 * 还没有任何发布版本时跳过，不让网页版部署失败；
 * 一旦发现发布版本，下载或校验出错就必须让构建失败——Pages 整站原子替换，放过去等于下载入口悄悄消失
 */
export async function fetchRelease(options: FetchReleaseOptions = {}): Promise<FetchReleaseResult> {
  const {
    repo = DEFAULT_REPO,
    outDir = siteDownloadDir(),
    fetch: fetchImpl = globalThis.fetch,
    attempts = 3,
    delayMs = 2000,
    log = console.log
  } = options
  const retry = { attempts, delayMs }

  const manifestData = await download(releaseAssetUrl(repo, MANIFEST_NAME), fetchImpl, retry)
  if (!manifestData) {
    log(`${repo} 还没有发布桌面版，跳过安装包`)
    return { status: 'skipped' }
  }
  const manifest = manifestSchema.parse(JSON.parse(new TextDecoder().decode(manifestData)))

  const installer = await download(releaseAssetUrl(repo, manifest.file), fetchImpl, retry)
  if (!installer) {
    throw new Error(`发布版本 ${manifest.version} 缺少 ${manifest.file}`)
  }
  if (installer.byteLength !== manifest.size || sha256Hex(installer) !== manifest.sha256) {
    throw new Error(`安装包与 ${MANIFEST_NAME} 的大小或 sha256 不一致（可能恰逢新版本发布，重新构建即可）`)
  }

  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, INSTALLER_NAME), installer)
  await writeFile(join(outDir, MANIFEST_NAME), manifestData)
  log(`已放入桌面版 ${manifest.version}（${(manifest.size / 1024 / 1024).toFixed(1)} MiB）：${outDir}`)
  return { status: 'fetched', manifest }
}

const USAGE = '用法：node scripts/release.ts fetch | pack <安装包路径> <输出目录> <版本号>'

async function main(argv: string[]) {
  const [command, ...args] = argv
  if (command === 'fetch') {
    await fetchRelease({ repo: process.env.RELEASE_REPO, outDir: process.env.RELEASE_OUT_DIR })
    return
  }
  if (command === 'pack') {
    const [installerPath, outDir, version] = args
    if (!installerPath || !outDir || !version) {
      throw new Error(USAGE)
    }
    const manifest = await packRelease(installerPath, outDir, version)
    console.log(`已整理发布文件 ${manifest.version}（sha256 ${manifest.sha256}）：${outDir}`)
    return
  }
  throw new Error(USAGE)
}

if (import.meta.main) {
  await main(process.argv.slice(2))
}
