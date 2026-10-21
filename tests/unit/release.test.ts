import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatInstallerSize,
  INSTALLER_NAME,
  loadSiteRelease,
  MANIFEST_NAME,
  manifestSchema,
  SITE_INSTALLER_URL
} from '../../app/lib/release'
import {
  fetchRelease,
  packRelease,
  releaseAssetUrl,
  sha256Hex,
  siteDownloadDir
} from '../../scripts/release'

const REPO = 'owner/repo'
const installerBytes = new TextEncoder().encode('fake-installer-内容')

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'release-test-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function exists(path: string) {
  return stat(path).then(() => true, () => false)
}

/** 按 URL 末段（文件名）返回预设响应的 fetch 替身；未预设的文件按 404 处理 */
function releaseFetch(files: Record<string, Uint8Array | string | number>) {
  return vi.fn(async (url: string) => {
    const name = url.split('/').pop() as string
    const file = files[name]
    if (file === undefined) {
      return new Response(null, { status: 404 })
    }
    if (typeof file === 'number') {
      return new Response(null, { status: file })
    }
    return new Response(file as BodyInit, { status: 200 })
  })
}

function validManifest(overrides: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({
    version: '0.1.0',
    file: INSTALLER_NAME,
    sha256: sha256Hex(installerBytes),
    size: installerBytes.byteLength,
    date: '2026-10-21T00:00:00.000Z',
    ...overrides
  })
}

describe('releaseAssetUrl', () => {
  it('指向最新 Release 下的固定文件名', () => {
    expect(releaseAssetUrl(REPO, MANIFEST_NAME)).toBe('https://github.com/owner/repo/releases/latest/download/latest.json')
  })
})

describe('siteDownloadDir', () => {
  it('Cloudflare Pages 构建环境放进 dist（cloudflare-pages-static 的产物目录）', () => {
    expect(siteDownloadDir({ CF_PAGES: '1' })).toBe('dist/download')
  })

  it('其他环境放进 .output/public（static 预设的产物目录）', () => {
    expect(siteDownloadDir({})).toBe('.output/public/download')
    expect(siteDownloadDir({ CF_PAGES: '' })).toBe('.output/public/download')
  })
})

describe('packRelease', () => {
  it('安装包改成固定文件名，并写出带校验信息的 latest.json', async () => {
    const source = join(dir, 'AI修图大师_0.1.0_x64-setup.exe')
    await writeFile(source, installerBytes)
    const outDir = join(dir, 'out')

    const manifest = await packRelease(source, outDir, '0.1.0', new Date('2026-10-21T00:00:00Z'))

    expect(new Uint8Array(await readFile(join(outDir, INSTALLER_NAME)))).toEqual(installerBytes)
    const written = manifestSchema.parse(JSON.parse(await readFile(join(outDir, MANIFEST_NAME), 'utf8')))
    expect(written).toEqual(manifest)
    expect(manifest).toMatchObject({
      version: '0.1.0',
      file: INSTALLER_NAME,
      size: installerBytes.byteLength,
      sha256: sha256Hex(installerBytes),
      date: '2026-10-21T00:00:00.000Z'
    })
  })

  it('接受带预发布后缀的版本号，拒绝不是 x.y.z 的版本号', async () => {
    const source = join(dir, 'setup.exe')
    await writeFile(source, installerBytes)
    await expect(packRelease(source, join(dir, 'a'), '1.2.3-beta.1')).resolves.toMatchObject({ version: '1.2.3-beta.1' })
    await expect(packRelease(source, join(dir, 'b'), 'v1.2')).rejects.toThrow()
  })

  it('安装包不存在时抛出，不留下任何输出', async () => {
    const outDir = join(dir, 'out')
    await expect(packRelease(join(dir, 'missing.exe'), outDir, '0.1.0')).rejects.toThrow()
    expect(await exists(outDir)).toBe(false)
  })
})

describe('fetchRelease', () => {
  const options = () => ({ repo: REPO, outDir: join(dir, 'download'), delayMs: 0, log: vi.fn() })

  it('还没有发布版本（latest.json 是 404）时跳过，不创建目录', async () => {
    const opts = options()
    const fetchImpl = releaseFetch({})

    await expect(fetchRelease({ ...opts, fetch: fetchImpl })).resolves.toEqual({ status: 'skipped' })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(await exists(opts.outDir)).toBe(false)
  })

  it('下载安装包与 latest.json 并原样写入站点目录', async () => {
    const opts = options()
    const manifestText = validManifest()
    const fetchImpl = releaseFetch({ [MANIFEST_NAME]: manifestText, [INSTALLER_NAME]: installerBytes })

    const result = await fetchRelease({ ...opts, fetch: fetchImpl })

    expect(result.status).toBe('fetched')
    expect(fetchImpl).toHaveBeenCalledWith(releaseAssetUrl(REPO, MANIFEST_NAME))
    expect(fetchImpl).toHaveBeenCalledWith(releaseAssetUrl(REPO, INSTALLER_NAME))
    expect(new Uint8Array(await readFile(join(opts.outDir, INSTALLER_NAME)))).toEqual(installerBytes)
    expect(await readFile(join(opts.outDir, MANIFEST_NAME), 'utf8')).toBe(manifestText)
  })

  it('安装包与 latest.json 的 sha256 不一致时失败，不写入任何文件', async () => {
    const opts = options()
    const fetchImpl = releaseFetch({
      [MANIFEST_NAME]: validManifest({ sha256: 'a'.repeat(64) }),
      [INSTALLER_NAME]: installerBytes
    })

    await expect(fetchRelease({ ...opts, fetch: fetchImpl })).rejects.toThrow('不一致')
    expect(await exists(opts.outDir)).toBe(false)
  })

  it('大小不一致时失败', async () => {
    const opts = options()
    const fetchImpl = releaseFetch({
      [MANIFEST_NAME]: validManifest({ size: installerBytes.byteLength + 1 }),
      [INSTALLER_NAME]: installerBytes
    })

    await expect(fetchRelease({ ...opts, fetch: fetchImpl })).rejects.toThrow('不一致')
  })

  it('latest.json 存在而安装包缺失时失败，而不是当作没有发布', async () => {
    const opts = options()
    const fetchImpl = releaseFetch({ [MANIFEST_NAME]: validManifest() })

    await expect(fetchRelease({ ...opts, fetch: fetchImpl })).rejects.toThrow(INSTALLER_NAME)
  })

  it('latest.json 格式不对时失败', async () => {
    const opts = options()
    const fetchImpl = releaseFetch({ [MANIFEST_NAME]: JSON.stringify({ version: '0.1.0' }) })

    await expect(fetchRelease({ ...opts, fetch: fetchImpl })).rejects.toThrow()
  })

  it('服务端错误和网络异常会重试，之后成功就正常放行', async () => {
    const opts = options()
    let calls = 0
    const fetchImpl = vi.fn(async (url: string) => {
      calls++
      if (calls === 1) {
        return new Response(null, { status: 503 })
      }
      if (calls === 2) {
        throw new TypeError('fetch failed')
      }
      return url.endsWith(MANIFEST_NAME) ? new Response(validManifest()) : new Response(installerBytes)
    })

    const result = await fetchRelease({ ...opts, fetch: fetchImpl })

    expect(result.status).toBe('fetched')
    expect(calls).toBe(4)
  })

  it('持续失败时用尽重试次数后抛出，并带上最后一次的原因', async () => {
    const opts = options()
    const fetchImpl = releaseFetch({ [MANIFEST_NAME]: 500 })

    const error = await fetchRelease({ ...opts, fetch: fetchImpl, attempts: 3 }).catch((e: Error) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('已尝试 3 次')
    expect(((error as Error).cause as Error).message).toBe('HTTP 500')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})

describe('loadSiteRelease', () => {
  it('读取站点 /download/ 下的 latest.json 并按清单格式校验', async () => {
    const fetchImpl = vi.fn(async () => new Response(validManifest()))

    await expect(loadSiteRelease(fetchImpl)).resolves.toMatchObject({ version: '0.1.0', size: installerBytes.byteLength })
    expect(fetchImpl).toHaveBeenCalledWith('/download/latest.json', { cache: 'no-cache' })
  })

  it('站点还没有发布（404）时返回 null', async () => {
    await expect(loadSiteRelease(async () => new Response(null, { status: 404 }))).resolves.toBeNull()
  })

  it('未知路径被回退成 index.html（状态码 200）时返回 null', async () => {
    const html = '<!doctype html><html><body><div id="__nuxt"></div></body></html>'
    await expect(loadSiteRelease(async () => new Response(html, { headers: { 'content-type': 'text/html' } }))).resolves.toBeNull()
  })

  it('清单格式不对或网络出错时返回 null', async () => {
    await expect(loadSiteRelease(async () => new Response(JSON.stringify({ version: '0.1.0' })))).resolves.toBeNull()
    await expect(loadSiteRelease(async () => new Response(validManifest({ file: 'other.exe' })))).resolves.toBeNull()
    await expect(loadSiteRelease(async () => {
      throw new TypeError('Failed to fetch')
    })).resolves.toBeNull()
  })
})

describe('站点下载地址与大小', () => {
  it('安装包地址与 fetch 放进站点的位置一致', () => {
    expect(SITE_INSTALLER_URL).toBe(`/download/${INSTALLER_NAME}`)
  })

  it('大小按 MB 显示一位小数', () => {
    expect(formatInstallerSize(9 * 1024 * 1024)).toBe('9.0 MB')
    expect(formatInstallerSize(8_900_000)).toBe('8.5 MB')
  })
})
