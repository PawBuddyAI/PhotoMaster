import type { Metadata } from 'libraw-wasm'
import piexif from 'piexifjs'

/**
 * 从 RAW 读出、写进导出照片的拍摄信息。来源是 LibRaw 统一整理过的元数据（各家 RAW 格式通用），
 * 曝光补偿、时区、亚秒等 LibRaw 不提供的字段不写。可跨线程传递（纯数据）。
 */
export interface RawExif {
  make?: string
  model?: string
  /** 'YYYY:MM:DD HH:MM:SS'，相机记录的本地时间 */
  dateTime?: string
  exposureTime?: number
  fNumber?: number
  iso?: number
  focalLength?: number
  focalLength35?: number
  lensMake?: string
  lens?: string
  lensSerial?: string
  bodySerial?: string
  artist?: string
  description?: string
  gps?: {
    latitude: [number, number, number]
    latitudeRef: 'N' | 'S'
    longitude: [number, number, number]
    longitudeRef: 'E' | 'W'
    altitude?: number
    /** 0 为海平面以上，1 为以下 */
    altitudeRef?: number
  }
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\0/g, '').trim()
  return trimmed || undefined
}

function positive(value: number | undefined): number | undefined {
  return Number.isFinite(value) && value! > 0 ? value : undefined
}

/** LibRaw 按本地时区 mktime 解析 EXIF 时间，按本地时区格式化即得到原始的相机时间 */
export function exifDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function rawExifFromMetadata(meta: Metadata): RawExif {
  const exif: RawExif = {}
  const set = <K extends keyof RawExif>(key: K, value: RawExif[K] | undefined) => {
    if (value !== undefined) exif[key] = value
  }
  set('make', text(meta.camera_make))
  set('model', text(meta.camera_model))
  if (meta.timestamp instanceof Date && meta.timestamp.getTime() > 0) set('dateTime', exifDateTime(meta.timestamp))
  set('exposureTime', positive(meta.shutter))
  set('fNumber', positive(meta.aperture))
  set('iso', positive(meta.iso_speed))
  set('focalLength', positive(meta.focal_len))
  set('focalLength35', positive(meta.lens?.FocalLengthIn35mmFormat))
  set('lensMake', text(meta.lens?.LensMake))
  set('lens', text(meta.lens?.Lens) ?? text(meta.lens?.makernotes?.Lens))
  set('lensSerial', text(meta.lens?.LensSerial))
  set('bodySerial', text(meta.shootinginfo?.BodySerial))
  set('artist', text(meta.artist))
  set('description', text(meta.desc))
  const gps = meta.gps_data
  // gpsparsed 在部分机型上为真但坐标全空，以半球标记为准
  if (gps?.gpsparsed && (gps.latref === 'N' || gps.latref === 'S') && (gps.longref === 'E' || gps.longref === 'W')
    && [...gps.latitude, ...gps.longitude].every(Number.isFinite)) {
    exif.gps = {
      latitude: gps.latitude,
      latitudeRef: gps.latref,
      longitude: gps.longitude,
      longitudeRef: gps.longref,
      ...(Number.isFinite(gps.altitude) && gps.altitude !== 0 ? { altitude: gps.altitude, altitudeRef: gps.altref ? 1 : 0 } : {})
    }
  }
  return exif
}

/** EXIF 有理数：快门优先写成 1/n，其余按固定精度 */
export function rational(value: number, precision = 100): [number, number] {
  if (value < 1) {
    const denominator = Math.round(1 / value)
    if (denominator > 0 && Math.abs(1 / denominator - value) / value < 0.01) return [1, denominator]
    return [Math.round(value * 1_000_000), 1_000_000]
  }
  return [Math.round(value * precision), precision]
}

function dms(value: [number, number, number]): Array<[number, number]> {
  return [[Math.round(value[0]), 1], [Math.round(value[1]), 1], [Math.round(value[2] * 1000), 1000]]
}

/**
 * 导出用 EXIF（piexif 二进制串，含 "Exif\0\0" 头）：方向为 1（像素已摆正），像素尺寸为导出尺寸，
 * 不带缩略图。hdr 为真时色彩空间标为「未校准」（PQ 编码不是 sRGB）。
 */
export function buildRawExif(exif: RawExif, width: number, height: number, hdr = false): string {
  const zeroth: Record<number, unknown> = { [piexif.ImageIFD.Orientation]: 1 }
  const sub: Record<number, unknown> = {
    [piexif.ExifIFD.ExifVersion]: '0232',
    [piexif.ExifIFD.ColorSpace]: hdr ? 0xffff : 1,
    [piexif.ExifIFD.PixelXDimension]: width,
    [piexif.ExifIFD.PixelYDimension]: height
  }
  if (exif.make) zeroth[piexif.ImageIFD.Make] = exif.make
  if (exif.model) zeroth[piexif.ImageIFD.Model] = exif.model
  if (exif.artist) zeroth[piexif.ImageIFD.Artist] = exif.artist
  if (exif.description) zeroth[piexif.ImageIFD.ImageDescription] = exif.description
  if (exif.dateTime) {
    zeroth[piexif.ImageIFD.DateTime] = exif.dateTime
    sub[piexif.ExifIFD.DateTimeOriginal] = exif.dateTime
    sub[piexif.ExifIFD.DateTimeDigitized] = exif.dateTime
  }
  if (exif.exposureTime) sub[piexif.ExifIFD.ExposureTime] = rational(exif.exposureTime, 10)
  if (exif.fNumber) sub[piexif.ExifIFD.FNumber] = rational(exif.fNumber, 10)
  if (exif.iso) sub[piexif.ExifIFD.ISOSpeedRatings] = Math.min(65535, Math.round(exif.iso))
  if (exif.focalLength) sub[piexif.ExifIFD.FocalLength] = rational(exif.focalLength, 100)
  if (exif.focalLength35) sub[piexif.ExifIFD.FocalLengthIn35mmFilm] = Math.min(65535, Math.round(exif.focalLength35))
  if (exif.lensMake) sub[piexif.ExifIFD.LensMake] = exif.lensMake
  if (exif.lens) sub[piexif.ExifIFD.LensModel] = exif.lens
  if (exif.lensSerial) sub[piexif.ExifIFD.LensSerialNumber] = exif.lensSerial
  if (exif.bodySerial) sub[piexif.ExifIFD.BodySerialNumber] = exif.bodySerial
  const gps: Record<number, unknown> = {}
  if (exif.gps) {
    gps[piexif.GPSIFD.GPSVersionID] = [2, 3, 0, 0]
    gps[piexif.GPSIFD.GPSLatitudeRef] = exif.gps.latitudeRef
    gps[piexif.GPSIFD.GPSLatitude] = dms(exif.gps.latitude)
    gps[piexif.GPSIFD.GPSLongitudeRef] = exif.gps.longitudeRef
    gps[piexif.GPSIFD.GPSLongitude] = dms(exif.gps.longitude)
    if (exif.gps.altitude !== undefined) {
      gps[piexif.GPSIFD.GPSAltitudeRef] = exif.gps.altitudeRef ?? 0
      gps[piexif.GPSIFD.GPSAltitude] = [Math.round(Math.abs(exif.gps.altitude) * 100), 100]
    }
  }
  return piexif.dump({ '0th': zeroth, 'Exif': sub, 'GPS': gps })
}

/** PNG 的 eXIf 块内容：去掉 "Exif\0\0" 头的 TIFF 结构 */
export function exifTiffBytes(exif: string): Uint8Array<ArrayBuffer> {
  const body = exif.startsWith('Exif\0\0') ? exif.slice(6) : exif
  return Uint8Array.from(body, c => c.charCodeAt(0))
}
