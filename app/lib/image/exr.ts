import { srgbToRec2020 } from './hdr'

const text = (value: string) => new TextEncoder().encode(value + '\0')
function bytes(size: number, fill: (view: DataView) => void): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(size)
  fill(new DataView(data.buffer))
  return data
}
function join(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)

    offset += part.length
  }
  return result
}
function attribute(name: string, type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  return join([text(name), text(type), bytes(4, v => v.setUint32(0, data.length, true)), data])
}

/** OpenEXR v2、无压缩 FLOAT32 RGB 扫描线。负数和超白值保持原样，色度为 Rec.2020 D65。 */
export async function encodeExr(width: number, height: number, bands: AsyncIterable<Float32Array>, referenceWhite: number): Promise<Blob> {
  const channels = join([...['B', 'G', 'R'].map(name => join([text(name), bytes(16, (v) => {
    v.setInt32(0, 2, true) // FLOAT
    v.setInt32(8, 1, true)
    v.setInt32(12, 1, true)
  })])), new Uint8Array([0])])
  const window = bytes(16, (v) => {
    v.setInt32(8, width - 1, true)

    v.setInt32(12, height - 1, true)
  })
  const header = join([
    bytes(8, (v) => {
      v.setUint32(0, 20000630, true)

      v.setUint32(4, 2, true)
    }),
    attribute('channels', 'chlist', channels), attribute('compression', 'compression', new Uint8Array([0])),
    attribute('dataWindow', 'box2i', window), attribute('displayWindow', 'box2i', window),
    attribute('lineOrder', 'lineOrder', new Uint8Array([0])),
    attribute('pixelAspectRatio', 'float', bytes(4, v => v.setFloat32(0, 1, true))),
    attribute('screenWindowCenter', 'v2f', new Uint8Array(8)),
    attribute('screenWindowWidth', 'float', bytes(4, v => v.setFloat32(0, 1, true))),
    attribute('chromaticities', 'chromaticities', bytes(32, (v) => {
      [0.708, 0.292, 0.17, 0.797, 0.131, 0.046, 0.3127, 0.329].forEach((n, i) => v.setFloat32(i * 4, n, true))
    })),
    attribute('whiteLuminance', 'float', bytes(4, v => v.setFloat32(0, referenceWhite, true))),
    new Uint8Array([0])
  ])
  const rowSize = 8 + width * 12
  const offsets = bytes(height * 8, (v) => {
    for (let y = 0; y < height; y++) v.setBigUint64(y * 8, BigInt(header.length + height * 8 + y * rowSize), true)
  })
  const parts: BlobPart[] = [header, offsets]
  let row = 0
  for await (const band of bands) {
    const rows = band.length / (width * 4)
    if (!Number.isInteger(rows) || row + rows > height) throw new Error('EXR 像素数量不匹配。')
    const data = bytes(rowSize * rows, (v) => {
      for (let y = 0; y < rows; y++) {
        const start = y * rowSize
        v.setInt32(start, row + y, true)
        v.setUint32(start + 4, width * 12, true)
        for (let x = 0; x < width; x++) {
          const p = (y * width + x) * 4
          const rgb = srgbToRec2020(band[p]!, band[p + 1]!, band[p + 2]!)
          for (let c = 0; c < 3; c++) {
            if (!Number.isFinite(rgb[c])) throw new Error('EXR 像素包含非有限值。')
            v.setFloat32(start + 8 + ((2 - c) * width + x) * 4, rgb[c]!, true)
          }
        }
      }
    })
    parts.push(data)
    row += rows
  }
  if (row !== height) throw new Error('EXR 像素数量不匹配。')
  return new Blob(parts, { type: 'image/x-exr' })
}
