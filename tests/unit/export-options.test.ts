import { describe, expect, it } from 'vitest'
import { baseName, canKeepExif, DEFAULT_EXPORT_QUALITY, defaultExportOptions, formatFromPath, RAW_EXIF_FORMATS } from '~/lib/image/export-options'

describe('formatFromPath', () => {
  it('由扩展名判断格式，忽略大小写与目录里的点', () => {
    expect(formatFromPath('D:\\照片\\海边.JPG')).toBe('image/jpeg')
    expect(formatFromPath('D:\\a.b\\海边.jpeg')).toBe('image/jpeg')
    expect(formatFromPath('/home/me/海边.png')).toBe('image/png')
    expect(formatFromPath('海边.webp')).toBe('image/webp')
  })

  it('认不出的扩展名、没有扩展名都返回 null', () => {
    expect(formatFromPath('D:\\照片\\海边.gif')).toBeNull()
    expect(formatFromPath('D:\\照片.d\\海边')).toBeNull()
    expect(formatFromPath('')).toBeNull()
  })
})

describe('baseName', () => {
  it('取最后一段，Windows 与 POSIX 的分隔符都算', () => {
    expect(baseName('D:\\照片\\海边.jpg')).toBe('海边.jpg')
    expect(baseName('/home/me/海边.jpg')).toBe('海边.jpg')
    expect(baseName('海边.jpg')).toBe('海边.jpg')
  })
})

describe('defaultExportOptions（桌面版「保存」写入文件的参数）', () => {
  it('JPEG 原图：保存为 JPEG，保留 EXIF', () => {
    expect(defaultExportOptions('image/jpeg')).toEqual({ format: 'image/jpeg', quality: DEFAULT_EXPORT_QUALITY, keepExif: true })
    expect(defaultExportOptions('image/jpeg', 'D:\\照片\\海边.jpg')).toEqual({ format: 'image/jpeg', quality: DEFAULT_EXPORT_QUALITY, keepExif: true })
  })

  it('PNG、WebP 原图：沿用原格式，没有 EXIF 可保留', () => {
    expect(defaultExportOptions('image/png')).toEqual({ format: 'image/png', quality: DEFAULT_EXPORT_QUALITY, keepExif: false })
    expect(defaultExportOptions('image/webp')).toEqual({ format: 'image/webp', quality: DEFAULT_EXPORT_QUALITY, keepExif: false })
  })

  it('格式跟着文件扩展名走：JPEG 原图存成 .png 时按 PNG 编码，不保留 EXIF', () => {
    expect(defaultExportOptions('image/jpeg', 'D:\\照片\\海边.png')).toEqual({ format: 'image/png', quality: DEFAULT_EXPORT_QUALITY, keepExif: false })
  })

  it('扩展名认不出时沿用原图格式', () => {
    expect(defaultExportOptions('image/png', 'D:\\照片\\海边')).toMatchObject({ format: 'image/png' })
  })

  it('无法识别的原图格式回退为 JPEG，且不保留 EXIF', () => {
    expect(defaultExportOptions('')).toEqual({ format: 'image/jpeg', quality: DEFAULT_EXPORT_QUALITY, keepExif: false })
    expect(defaultExportOptions('image/gif')).toEqual({ format: 'image/jpeg', quality: DEFAULT_EXPORT_QUALITY, keepExif: false })
  })

  it('RAW 工程：拍摄信息从原件读取，存成 JPEG / PNG 时保留，WebP 不保留', () => {
    expect(defaultExportOptions('image/png', 'D:\\照片\\海边.jpg', true)).toEqual({ format: 'image/jpeg', quality: DEFAULT_EXPORT_QUALITY, keepExif: true })
    expect(defaultExportOptions('image/png', undefined, true)).toEqual({ format: 'image/png', quality: DEFAULT_EXPORT_QUALITY, keepExif: true })
    expect(defaultExportOptions('image/png', 'D:\\照片\\海边.webp', true)).toMatchObject({ keepExif: false })
  })
})

describe('canKeepExif', () => {
  it('RAW 工程支持 JPEG、Ultra HDR、PNG、HDR PNG；不支持 WebP、EXR', () => {
    expect(RAW_EXIF_FORMATS).toEqual(['image/jpeg', 'image/ultrahdr', 'image/png', 'image/png-hdr'])
    for (const format of RAW_EXIF_FORMATS) expect(canKeepExif(format, 'image/png', true)).toBe(true)
    expect(canKeepExif('image/webp', 'image/png', true)).toBe(false)
    expect(canKeepExif('image/x-exr', 'image/png', true)).toBe(false)
  })

  it('普通照片：只有 JPEG 原图存成 JPEG 时可保留', () => {
    expect(canKeepExif('image/jpeg', 'image/jpeg', false)).toBe(true)
    expect(canKeepExif('image/png', 'image/jpeg', false)).toBe(false)
    expect(canKeepExif('image/jpeg', 'image/png', false)).toBe(false)
  })
})
