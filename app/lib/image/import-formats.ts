import { FORMAT_EXTENSIONS } from './export-options'

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
// 扩展名用于选择文件；是否兼容仍由解码器按机型和压缩方式判断。
export const RAW_EXTENSIONS = ['raw', 'dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'rw2', 'orf', 'pef', 'srw', 'rwl', '3fr', 'fff', 'iiq', 'kdc', 'dcr', 'mos', 'mrw', 'x3f']
export const IMPORT_EXTENSIONS = [...['image/jpeg', 'image/png', 'image/webp'].flatMap(type => FORMAT_EXTENSIONS[type as keyof typeof FORMAT_EXTENSIONS]), ...RAW_EXTENSIONS]
export const IMAGE_ACCEPT = [...SUPPORTED_IMAGE_TYPES, ...RAW_EXTENSIONS.map(ext => `.${ext}`)].join(',')

export function isRawFile(name: string): boolean {
  const extension = /\.([^.\\/]+)$/.exec(name)?.[1]?.toLowerCase()
  return !!extension && RAW_EXTENSIONS.includes(extension)
}
