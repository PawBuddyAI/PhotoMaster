/** Independent OpenEXR scanline reader for validating offsets, attributes and FLOAT samples. */
export function readExr(data: Uint8Array) {
  const bytes = Buffer.from(data)
  if (bytes.readUInt32LE(0) !== 20000630 || bytes.readUInt32LE(4) !== 2) throw new Error('EXR signature/version')
  let offset = 8
  const string = () => {
    const end = bytes.indexOf(0, offset)
    if (end < offset) throw new Error('EXR string')
    const result = bytes.toString('ascii', offset, end)
    offset = end + 1
    return result
  }
  const attributes = new Map<string, Buffer>()
  while (true) {
    const name = string()
    if (!name) break
    string()
    const length = bytes.readUInt32LE(offset)
    offset += 4
    attributes.set(name, bytes.subarray(offset, offset + length))
    offset += length
  }
  const window = attributes.get('dataWindow')!
  const width = window.readInt32LE(8) + 1
  const height = window.readInt32LE(12) + 1
  const rgb = new Float32Array(width * height * 3)
  if (attributes.get('compression')![0] !== 0) throw new Error('EXR compression')
  for (let y = 0; y < height; y++) {
    const start = Number(bytes.readBigUInt64LE(offset + y * 8))
    if (bytes.readInt32LE(start) !== y || bytes.readUInt32LE(start + 4) !== width * 12) throw new Error('EXR scanline')
    for (let c = 0; c < 3; c++) {
      for (let x = 0; x < width; x++) rgb[(y * width + x) * 3 + c] = bytes.readFloatLE(start + 8 + ((2 - c) * width + x) * 4)
    }
  }
  return { width, height, rgb, attributes }
}
