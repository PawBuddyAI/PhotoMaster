/** RAW 导入失败的原因；message 面向用户，直接显示在提示里。 */
export class RawImportError extends Error {
  override name = 'RawImportError'
}

export const RAW_CONVERT_HINT = '可以先转换为 JPEG / PNG 后导入。'

export const RAW_UNRECOGNIZED = `认不出这个文件：它可能不是相机 RAW，或者这台相机的格式暂不支持。${RAW_CONVERT_HINT}`
export const RAW_OUT_OF_MEMORY = '内存不够，解不开这张 RAW。请关闭其他标签页或程序后重试。'
const RAW_UNKNOWN = `无法解码这张 RAW。${RAW_CONVERT_HINT}`

/** 只取推断原因需要的元数据字段，避免依赖 libraw-wasm 的完整类型。 */
interface UndecodableHints {
  dng_version?: number
  nikon?: { NEFCompression?: number }
}

/**
 * libraw-wasm 1.6.0 解码失败时不带 LibRaw 错误码（imageData 直接返回空），只能按格式线索推断原因。
 * NEFCompression 13 / 14 是尼康高效率 RAW（HE / HE★），LibRaw 0.22 只支持标准压缩。
 */
export function undecodableReason(meta: UndecodableHints | undefined): string {
  const nef = meta?.nikon?.NEFCompression
  if (nef === 13 || nef === 14) {
    return '这张是尼康「高效率」RAW（HE / HE★），暂不支持。请在相机里改用无损压缩 RAW 拍摄，或先转换为 JPEG / PNG 后导入。'
  }
  if (meta?.dng_version) {
    return `这张 DNG 用了暂不支持的压缩方式，常见于 iPhone 以 JPEG-XL 保存的 ProRAW，以及修图软件合成的 HDR / 全景 DNG；也可能是文件已损坏。${RAW_CONVERT_HINT}`
  }
  return `这张 RAW 用了暂不支持的压缩方式，或者文件已损坏。${RAW_CONVERT_HINT}`
}

/** WASM 堆增长失败、ArrayBuffer 分配失败等都表现为这些信息；越界访问不算内存不足。 */
const OUT_OF_MEMORY = /out of memory|allocation failed|\bOOM\b|maximum memory|enlarge memory/i

/** Worker 里的任意异常 → 给用户看的一句话。 */
export function describeRawFailure(error: unknown): string {
  if (error instanceof RawImportError) return error.message
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof RangeError || OUT_OF_MEMORY.test(message)) return RAW_OUT_OF_MEMORY
  return RAW_UNKNOWN
}
