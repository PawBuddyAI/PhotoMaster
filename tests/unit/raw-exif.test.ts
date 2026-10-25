import type { Metadata } from 'libraw-wasm'
import piexif from 'piexifjs'
import { describe, expect, it } from 'vitest'
import { buildRawExif, exifDateTime, exifTiffBytes, rational, rawExifFromMetadata } from '~/lib/image/raw-exif'

/** 实测 Pixel 4a 与尼康 Z fc 的 LibRaw 元数据（节选） */
function pixel(): Metadata {
  return {
    camera_make: 'Google', camera_model: 'Pixel 4a', iso_speed: 55, shutter: 0.004005216993391514, aperture: 1.7000000476837158,
    focal_len: 4.380000114440918, timestamp: new Date(2020, 10, 21, 11, 2, 51), artist: '', desc: '',
    lens: { Lens: '', LensMake: '', LensSerial: '', FocalLengthIn35mmFormat: 27, makernotes: { Lens: '' } },
    shootinginfo: { BodySerial: '' },
    gps_data: { latitude: [47, 57, 30.63238525390625], longitude: [11, 50, 46.405670166015625], altitude: 602.3510131835938, latref: 'N', longref: 'E', altref: 0, gpsstatus: null, gpsparsed: true }
  } as unknown as Metadata
}

function nikon(): Metadata {
  return {
    camera_make: 'Nikon', camera_model: 'Z fc', iso_speed: 100, shutter: 1, aperture: 9, focal_len: 46,
    timestamp: new Date(2025, 8, 5, 18, 14, 56), artist: 'Simon Eilting', desc: '   ',
    lens: { Lens: '18-70mm f/3.5-4.5G', LensMake: '', LensSerial: '', FocalLengthIn35mmFormat: 69, makernotes: { Lens: '' } },
    shootinginfo: { BodySerial: '6015299' },
    // gpsparsed 为真但坐标全空（实测佳能、尼康样张）
    gps_data: { latitude: [0, 0, 0], longitude: [0, 0, 0], altitude: 0, latref: null, longref: null, altref: 0, gpsstatus: null, gpsparsed: true }
  } as unknown as Metadata
}

describe('从 LibRaw 元数据整理拍摄信息', () => {
  it('拍摄时间按本地时间写回原始的相机时间', () => {
    expect(exifDateTime(new Date(2020, 10, 21, 11, 2, 51))).toBe('2020:11:21 11:02:51')
    expect(rawExifFromMetadata(pixel()).dateTime).toBe('2020:11:21 11:02:51')
    expect(rawExifFromMetadata({ ...pixel(), timestamp: new Date(0) }).dateTime).toBeUndefined()
  })

  it('空字符串、0 值与无效 GPS 不写；镜头名缺失时取厂商信息里的', () => {
    const z = rawExifFromMetadata(nikon())
    expect(z).toEqual({
      make: 'Nikon', model: 'Z fc', dateTime: '2025:09:05 18:14:56', exposureTime: 1, fNumber: 9, iso: 100, focalLength: 46,
      focalLength35: 69, lens: '18-70mm f/3.5-4.5G', bodySerial: '6015299', artist: 'Simon Eilting'
    })
    const canon = rawExifFromMetadata({ ...nikon(), lens: { Lens: '', LensMake: '', LensSerial: '', FocalLengthIn35mmFormat: 0, makernotes: { Lens: 'EF-S 18-55mm f/3.5-5.6 IS' } } } as unknown as Metadata)
    expect(canon.lens).toBe('EF-S 18-55mm f/3.5-5.6 IS')
    expect(canon.focalLength35).toBeUndefined()
  })

  it('GPS 带半球与海拔', () => {
    expect(rawExifFromMetadata(pixel()).gps).toEqual({
      latitude: [47, 57, 30.63238525390625], latitudeRef: 'N', longitude: [11, 50, 46.405670166015625], longitudeRef: 'E',
      altitude: 602.3510131835938, altitudeRef: 0
    })
  })
})

describe('写成导出用的 EXIF', () => {
  it('有理数：快门写成 1/n，其余按精度', () => {
    expect(rational(0.004005216993391514, 10)).toEqual([1, 250])
    expect(rational(1 / 3, 10)).toEqual([1, 3])
    expect(rational(0.0007, 10)).toEqual([1, 1429])
    // 不接近 1/n 的值按百万分之一精度
    expect(rational(0.6, 10)).toEqual([600_000, 1_000_000])
    expect(rational(2.5, 10)).toEqual([25, 10])
    expect(rational(4.380000114440918, 100)).toEqual([438, 100])
  })

  it('piexif 能读回各字段；方向为 1，尺寸为导出尺寸，SDR 标 sRGB、HDR 标未校准', () => {
    const dump = buildRawExif(rawExifFromMetadata(pixel()), 4016, 3008)
    const exif = piexif.load(dump)
    expect(exif['0th']![piexif.ImageIFD.Make]).toBe('Google')
    expect(exif['0th']![piexif.ImageIFD.Model]).toBe('Pixel 4a')
    expect(exif['0th']![piexif.ImageIFD.Orientation]).toBe(1)
    expect(exif.Exif![piexif.ExifIFD.DateTimeOriginal]).toBe('2020:11:21 11:02:51')
    expect(exif.Exif![piexif.ExifIFD.ExposureTime]).toEqual([1, 250])
    expect(exif.Exif![piexif.ExifIFD.FNumber]).toEqual([17, 10])
    expect(exif.Exif![piexif.ExifIFD.ISOSpeedRatings]).toBe(55)
    expect(exif.Exif![piexif.ExifIFD.FocalLengthIn35mmFilm]).toBe(27)
    expect(exif.Exif![piexif.ExifIFD.PixelXDimension]).toBe(4016)
    expect(exif.Exif![piexif.ExifIFD.PixelYDimension]).toBe(3008)
    expect(exif.Exif![piexif.ExifIFD.ColorSpace]).toBe(1)
    expect(exif.GPS![piexif.GPSIFD.GPSLatitudeRef]).toBe('N')
    expect(piexif.GPSHelper.dmsRationalToDeg(exif.GPS![piexif.GPSIFD.GPSLatitude], 'N')).toBeCloseTo(47 + 57 / 60 + 30.632 / 3600, 5)
    expect(exif.GPS![piexif.GPSIFD.GPSAltitude]).toEqual([60235, 100])
    expect(piexif.load(buildRawExif(rawExifFromMetadata(nikon()), 10, 10, true)).Exif![piexif.ExifIFD.ColorSpace]).toBe(0xffff)
    expect(piexif.load(buildRawExif(rawExifFromMetadata(nikon()), 10, 10)).GPS).toEqual({})
  })

  it('PNG 的 eXIf 块是去掉 "Exif\\0\\0" 头的 TIFF', () => {
    const bytes = exifTiffBytes(buildRawExif({ make: 'X' }, 1, 1))
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('MM\0*')
  })
})
