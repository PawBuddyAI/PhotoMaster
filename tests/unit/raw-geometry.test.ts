import { describe, expect, it } from 'vitest'
import { type GainMapOp, parseOpcodeList, readDngCorrections, type VignetteOp, type WarpOp } from '~/lib/image/dng-opcodes'
import { createRawGeometry, fromStage, toStage } from '~/lib/image/raw-geometry'
import { fixVignetteRadial, gainMap, makeDng, opcodeList, warpRectilinear, writeTiff } from '../fixtures/dng'

/** LibRaw 对 RGGB 阵列给出的 filters（实测） */
const RGGB = 0xB4B4B4B4

function bytes(value: { values: unknown }): Uint8Array {
  return new Uint8Array(value.values as Buffer)
}

function arrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

describe('DNG OpcodeList 解析', () => {
  it('读出 GainMap、WarpRectilinear、FixVignetteRadial；恒等 warp 无需施加，不支持的记为跳过', () => {
    const list = opcodeList([
      { id: 9, params: gainMap({ top: 0, left: 1, bottom: 10, right: 20 }, { pitch: 2, points: [2, 3], gains: [1, 2, 3, 4, 5, 6] }) },
      { id: 1, params: warpRectilinear([[1, 0, 0, 0, 0, 0]]), optional: true },
      { id: 1, params: warpRectilinear([[0.98, 0.1, -0.2, 0.05, 0, 0], [0.99, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0]], 0.4, 0.6) },
      { id: 3, params: fixVignetteRadial([0.5, 0.25]) },
      { id: 4, params: Buffer.alloc(8) }
    ])
    const { ops, skipped } = parseOpcodeList(bytes(list))
    expect(skipped).toEqual([4])
    expect(ops.map(op => op.kind)).toEqual(['gain', 'warp', 'vignette'])
    const gain = ops[0] as GainMapOp
    expect(gain).toMatchObject({ top: 0, left: 1, bottom: 10, right: 20, rowPitch: 2, colPitch: 2, pointsV: 2, pointsH: 3, spacingV: 1, spacingH: 0.5, mapPlanes: 1 })
    expect(Array.from(gain.gains)).toEqual([1, 2, 3, 4, 5, 6])
    expect((ops[1] as WarpOp)).toMatchObject({ cx: 0.4, cy: 0.6 })
    expect((ops[1] as WarpOp).planes).toHaveLength(3)
    expect((ops[2] as VignetteOp).k).toEqual([0.5, 0.25, 0, 0, 0])
  })

  it('参数被截断的 opcode 跳过，不影响其他项', () => {
    const list = opcodeList([{ id: 9, params: Buffer.alloc(40) }, { id: 3, params: fixVignetteRadial([1]) }])
    const { ops, skipped } = parseOpcodeList(bytes(list))
    expect(skipped).toEqual([9])
    expect(ops.map(op => op.kind)).toEqual(['vignette'])
  })
})

describe('读取 DNG 校正参数', () => {
  it('原始图像在 SubIFD 中时也能找到；DefaultCrop 相对 ActiveArea', () => {
    const dng = makeDng(1, {
      preview: { jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), width: 16, height: 12 },
      raw: {
        50829: { type: 4, values: [4, 6, 92, 126] },
        50719: { type: 4, values: [2, 3] },
        50720: { type: 4, values: [100, 80] },
        51009: opcodeList([{ id: 9, params: gainMap({ top: 0, left: 0, bottom: 88, right: 120 }, { pitch: 2, points: [2, 2], gains: [2, 1, 2, 1] }) }]),
        51022: opcodeList([{ id: 3, params: fixVignetteRadial([1]) }])
      }
    })
    const corrections = readDngCorrections(arrayBuffer(dng))!
    expect(corrections).toMatchObject({ width: 120, height: 88, crop: { x: 2, y: 3, w: 100, h: 80 }, skipped: [] })
    expect(corrections.before).toHaveLength(1)
    expect(corrections.after.map(op => op.kind)).toEqual(['vignette'])
  })

  it('没有 DefaultCrop 或裁剪等于整幅时不裁；超出范围的裁剪忽略', () => {
    expect(readDngCorrections(arrayBuffer(makeDng()))!.crop).toBeNull()
    const full = makeDng(1, { raw: { 50719: { type: 4, values: [0, 0] }, 50720: { type: 4, values: [128, 96] } } })
    expect(readDngCorrections(arrayBuffer(full))!.crop).toBeNull()
    const outside = makeDng(1, { raw: { 50719: { type: 4, values: [40, 0] }, 50720: { type: 4, values: [100, 96] } } })
    expect(readDngCorrections(arrayBuffer(outside))!.crop).toBeNull()
  })

  it('不是 DNG（普通 TIFF、CR3 / RAF 等非 TIFF 头）时返回 null', () => {
    const tiff = writeTiff({ tags: { 256: { type: 4, values: [4] }, 257: { type: 4, values: [4] } }, data: Buffer.alloc(16) })
    expect(readDngCorrections(arrayBuffer(tiff))).toBeNull()
    expect(readDngCorrections(arrayBuffer(Buffer.from('\0\0\0\x18ftypcrx '.padEnd(64, '\0'), 'latin1')))).toBeNull()
    expect(readDngCorrections(arrayBuffer(Buffer.from('FUJIFILMCCD-RAW 0201'.padEnd(64, '\0'), 'latin1')))).toBeNull()
  })
})

describe('坐标映射（与 LibRaw flip 一致）', () => {
  it('flip 6（顺时针 90°）：输出 (r, c) 来自未旋转的 (列 r, 行 H-1-c)，与实测相同', () => {
    // 未旋转 64×48；输出 48×64。实测：输出顶行都取自未旋转的第 0 列
    const [x, y] = toStage(6, 10.5, 0.5, 64, 48)
    expect([x, y]).toEqual([0.5, 47 - 10 + 0.5])
  })

  it('各方向往返一致', () => {
    for (const flip of [0, 3, 5, 6]) {
      const [sx, sy] = toStage(flip, 7.5, 3.5, 20, 10)
      expect(fromStage(flip, sx, sy, 20, 10)).toEqual([7.5, 3.5])
    }
  })
})

/** 未旋转 w×h、三通道的线性渐变：通道 c 的值 = 100·c + 10·行 + 列，插值后的样本值直接反映取样位置 */
function ramp(w: number, h: number): Uint16Array {
  return Uint16Array.from({ length: w * h * 3 }, (_, i) => {
    const p = Math.floor(i / 3)
    return 100 * (i % 3) + 10 * Math.floor(p / w) + p % w
  })
}

function readAt(geometry: ReturnType<typeof createRawGeometry>, pixel: number) {
  const samples = new Float64Array(3)
  const gains = new Float64Array(3)
  geometry.read(pixel, samples, gains)
  return { samples: Array.from(samples), gains: Array.from(gains) }
}

describe('镜头校正公式', () => {
  const geometry = (w: number, h: number, after: Array<WarpOp | VignetteOp>) =>
    createRawGeometry({ data: ramp(w, h), width: w, height: h, colors: 3, flip: 0, filters: RGGB, crop: null, corrections: { before: [], after } })

  it('暗角：增益 1 + k0·r² + k1·r⁴，半径按到最远角的距离归一化；没有 warp 时不插值', () => {
    const g = geometry(100, 50, [{ kind: 'vignette', k: [0.5, 0.25, 0, 0, 0], cx: 0.5, cy: 0.5 }])
    const r2 = (49.5 ** 2 + 24.5 ** 2) / (50 ** 2 + 25 ** 2)
    const corner = readAt(g, 0)
    corner.gains.forEach(v => expect(v).toBeCloseTo(1 + 0.5 * r2 + 0.25 * r2 * r2, 12))
    expect(corner.samples).toEqual([0, 100, 200])
  })

  it('畸变：kr1 让边缘的取样位置外移，切向项在中心线上产生纵向偏移', () => {
    // 像素 (12.5, 4.5)：到中心 (8, 4) 的偏移 (4.5, 0.5)，r² = 20.5 / 80；源位置 = 中心 + 偏移·(1 + 0.1·r²)
    const barrel = readAt(geometry(16, 8, [{ kind: 'warp', planes: [[1, 0.1, 0, 0, 0, 0]], cx: 0.5, cy: 0.5 }]), 4 * 16 + 12)
    const f = 1 + 0.1 * 20.5 / 80
    expect(barrel.samples[0]).toBeCloseTo(10 * (4 + 0.5 * f - 0.5) + (8 + 4.5 * f - 0.5), 6)
    // 切向（kt0）：x 偏移 kt0·2·dx·dy，y 偏移 kt0·(r² + 2·dy²)
    const tangential = readAt(geometry(16, 8, [{ kind: 'warp', planes: [[1, 0, 0, 0, 0.05, 0]], cx: 0.5, cy: 0.5 }]), 4 * 16 + 11)
    const max = Math.sqrt(80)
    const dx = 3.5 / max
    const dy = 0.5 / max
    const sourceX = 8 + max * (dx + 0.05 * 2 * dx * dy)
    const sourceY = 4 + max * (dy + 0.05 * (dx * dx + dy * dy + 2 * dy * dy))
    expect(tangential.samples[0]).toBeCloseTo(10 * (sourceY - 0.5) + sourceX - 0.5, 6)
  })

  it('增益图：按像素中心双线性插值，超出两端取边缘值', () => {
    const op = parseOpcodeList(bytes(opcodeList([{ id: 9, params: gainMap({ top: 0, left: 0, bottom: 10, right: 10 }, { points: [2, 2], gains: [1, 3, 1, 3] }) }]))).ops[0] as GainMapOp
    const g = createRawGeometry({ data: ramp(10, 10), width: 10, height: 10, colors: 3, flip: 0, filters: RGGB, crop: null, corrections: { before: [op], after: [] } })
    // 像素中心 x = 0.5 / 9.5 对应 map 坐标 0.05 / 0.95
    expect(readAt(g, 0).gains[0]).toBeCloseTo(1.1, 12)
    expect(readAt(g, 9).gains[2]).toBeCloseTo(2.9, 12)
  })
})

describe('逐像素读取', () => {
  // 未旋转 4×2、三通道，样本值编码位置：通道 c 的值 = 100·c + 10·y + x
  const width = 4
  const height = 2
  const data = Uint16Array.from({ length: width * height * 3 }, (_, i) => {
    const p = Math.floor(i / 3)
    return 100 * (i % 3) + 10 * Math.floor(p / width) + p % width
  })
  const read = (geometry: ReturnType<typeof createRawGeometry>, pixel: number) => {
    const samples = new Float64Array(3)
    const gains = new Float64Array(3)
    geometry.read(pixel, samples, gains)
    return { samples: Array.from(samples), gains: Array.from(gains) }
  }

  it('没有校正时逐样本拷贝，DefaultCrop 偏移生效', () => {
    const geometry = createRawGeometry({ data, width, height, colors: 3, flip: 0, filters: RGGB, crop: { x: 1, y: 1, w: 2, h: 1 }, corrections: null })
    expect([geometry.width, geometry.height, geometry.corrected]).toEqual([2, 1, false])
    expect(read(geometry, 0)).toEqual({ samples: [11, 111, 211], gains: [1, 1, 1] })
    expect(read(geometry, 1).samples).toEqual([12, 112, 212])
  })

  it('去马赛克前的增益图按 Bayer 相位作用到对应通道，两个绿取平均', () => {
    const map = (top: number, left: number, gain: number) => parseOpcodeList(bytes(opcodeList([{ id: 9, params: gainMap({ top, left, bottom: 2, right: 4 }, { pitch: 2, points: [1, 1], gains: [gain] }) }]))).ops[0] as GainMapOp
    const geometry = createRawGeometry({
      data, width, height, colors: 3, flip: 0, filters: RGGB, crop: null,
      corrections: { before: [map(0, 0, 2), map(0, 1, 3), map(1, 0, 5), map(1, 1, 7)], after: [] }
    })
    expect(geometry.corrected).toBe(true)
    const { samples, gains } = read(geometry, 5)
    expect(gains).toEqual([2, 4, 7])
    // 没有 warp 时插值位置正好在像素中心，样本不变
    samples.forEach((v, c) => expect(v).toBeCloseTo(100 * c + 10 + 1, 9))
  })

  it('去马赛克后的暗角与畸变：增益按位置取值，warp 改变取样位置', () => {
    const w = 16
    const h = 8
    const ramp = Uint16Array.from({ length: w * h * 3 }, (_, i) => {
      const p = Math.floor(i / 3)
      return 100 * (i % 3) + 10 * Math.floor(p / w) + p % w
    })
    // 列表顺序：先 warp 后暗角；逆序处理时暗角在输出位置取值，warp 再把位置缩向中心
    const geometry = createRawGeometry({
      data: ramp, width: w, height: h, colors: 3, flip: 0, filters: RGGB, crop: null,
      corrections: { before: [], after: [
        { kind: 'warp', planes: [[0.5, 0, 0, 0, 0, 0]], cx: 0.5, cy: 0.5 },
        { kind: 'vignette', k: [1, 0, 0, 0, 0], cx: 0.5, cy: 0.5 }
      ] }
    })
    // 输出像素 (12.5, 1.5)：到中心 (8, 4) 的偏移 (4.5, -2.5)，最远角距离 √80；取样位置 (10.25, 2.75)
    const { samples, gains } = read(geometry, 1 * w + 12)
    gains.forEach(g => expect(g).toBeCloseTo(1 + (4.5 ** 2 + 2.5 ** 2) / 80, 9))
    // 线性渐变的内部，Catmull-Rom 插值精确还原：样本值反映取样位置（像素中心为整数 + 0.5）
    samples.forEach((v, c) => expect(v).toBeCloseTo(100 * c + 10 * 2.25 + 9.75, 6))
  })

  it('旋转后的输出：flip 6 的第一个输出像素取自未旋转的左下角', () => {
    // 缓冲区是 LibRaw 已旋转的输出（2×4），未旋转为 4×2
    const rotated = createRawGeometry({ data, width: 2, height: 4, colors: 3, flip: 6, filters: RGGB, crop: null, corrections: null })
    expect([rotated.width, rotated.height]).toEqual([2, 4])
    expect(read(rotated, 0).samples).toEqual([0, 100, 200])
  })
})
