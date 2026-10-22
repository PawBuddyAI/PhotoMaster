import * as twgl from 'twgl.js'
import { isIdentityParams } from '../adjust/params'
import type { Affine } from '../geometry/crop'
import type { AdjustParams } from '../types'
import {
  ADJUST_FRAG,
  BLUR_FRAG,
  DECODE_FRAG,
  DOWNSAMPLE_FRAG,
  ENCODE_FRAG,
  FULLSCREEN_VERT,
  LUMA_FRAG,
  MAX_BLUR_RADIUS
} from './shaders'

export interface MaskTexture {
  /** 内容键：键不变时复用已上传的纹理 */
  key: string
  data: Uint8Array | Float32Array
  width: number
  height: number
  /** 蒙版全为 0 时整层跳过 */
  empty: boolean
}

export interface RenderLayer {
  params: AdjustParams
  /** null 表示全图生效 */
  mask: MaskTexture | null
}

/** 清晰度模糊半径（相对整图长边），与分辨率无关，保证预览与导出观感一致 */
export const CLARITY_SIGMA_RATIO = 0.012
/** 锐化模糊半径（相对整图长边），下限 0.5 像素 */
export const SHARPEN_SIGMA_RATIO = 0.00035

/** 分块渲染时为保证模糊结果一致所需的边距（像素） */
export function blurPadding(imageLongSide: number): number {
  return Math.ceil(3 * (CLARITY_SIGMA_RATIO * imageLongSide + Math.max(0.5, SHARPEN_SIGMA_RATIO * imageLongSide))) + 4
}

type Fbo = twgl.FramebufferInfo

/**
 * WebGL2 调色渲染器。可在主线程（HTMLCanvasElement）和 Worker（OffscreenCanvas）中使用：
 * setSource 上传底图并解码到线性空间 → process 逐层施加调整 → present 画到画布或 readPixels 读回像素。
 */
export class PhotoRenderer {
  readonly gl: WebGL2RenderingContext
  /** twgl 的类型声明基于 WebGL1，这里用同一个上下文的 WebGL1 视图调用 twgl */
  private readonly tgl: WebGLRenderingContext
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas
  private readonly quad: twgl.BufferInfo
  private readonly programs: Record<'decode' | 'luma' | 'downsample' | 'blur' | 'adjust' | 'encode', twgl.ProgramInfo>
  private readonly floatAttachment: twgl.AttachmentOptions
  private readonly fbos = new Map<string, Fbo>()
  private readonly maskTextures = new Map<string, WebGLTexture>()
  private readonly dummyTexture: WebGLTexture
  private sourceTexture: WebGLTexture | null = null
  private result: Fbo | null = null
  private width = 0
  private height = 0

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, private readonly highPrecision = false) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true
    }) as WebGL2RenderingContext | null
    if (!gl) {
      throw new Error('当前浏览器不支持 WebGL2，无法进行调色渲染')
    }
    this.canvas = canvas
    this.gl = gl
    this.tgl = gl as unknown as WebGLRenderingContext

    const hasFloatTarget = !!gl.getExtension('EXT_color_buffer_float')
    if (highPrecision && (!hasFloatTarget || !gl.getExtension('OES_texture_float_linear'))) {
      throw new Error('当前设备不支持 RAW 高精度浮点调色，请开启硬件加速或换用支持的浏览器 / 设备。')
    }
    this.floatAttachment = {
      internalFormat: highPrecision ? gl.RGBA32F : hasFloatTarget ? gl.RGBA16F : gl.RGBA8,
      format: gl.RGBA,
      type: highPrecision ? gl.FLOAT : hasFloatTarget ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      min: gl.LINEAR,
      mag: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE
    }

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)

    const create = (frag: string) => twgl.createProgramInfo(this.tgl, [FULLSCREEN_VERT, frag], (msg: string) => {
      throw new Error(`着色器编译失败：${msg}`)
    })
    this.programs = {
      decode: create(DECODE_FRAG),
      luma: create(LUMA_FRAG),
      downsample: create(DOWNSAMPLE_FRAG),
      blur: create(BLUR_FRAG),
      adjust: create(ADJUST_FRAG),
      encode: create(ENCODE_FRAG)
    }
    this.quad = twgl.createBufferInfoFromArrays(this.tgl, {
      position: { numComponents: 2, data: [-1, -1, 3, -1, -1, 3] }
    })
    this.dummyTexture = twgl.createTexture(this.tgl, {
      src: [0, 0, 0, 255],
      width: 1,
      height: 1,
      min: gl.NEAREST,
      mag: gl.NEAREST
    })
  }

  get maxTextureSize(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number
  }

  get size(): { width: number, height: number } {
    return { width: this.width, height: this.height }
  }

  isContextLost(): boolean {
    return this.gl.isContextLost()
  }

  /** 上传底图（8 位 sRGB）并解码到线性空间；底图尺寸即渲染尺寸 */
  setSource(source: TexImageSource, width: number, height: number): void {
    const gl = this.gl
    if (this.sourceTexture) {
      gl.deleteTexture(this.sourceTexture)
    }
    this.sourceTexture = twgl.createTexture(this.tgl, {
      src: source,
      width,
      height,
      min: gl.NEAREST,
      mag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE,
      auto: false
    })
    this.width = width
    this.height = height
    const base = this.fbo('base', width, height)
    this.draw(this.programs.decode, base, { uSource: this.sourceTexture, uLinear: 0 })
    this.result = base
  }

  /** RAW 数据以 Float32 上传，RGBA32F 中间缓冲保留 16 位源的低位及超出 1 的调整结果。 */
  setLinearSource(data: Float32Array, width: number, height: number): void {
    if (!this.highPrecision) throw new Error('高位深底图需要高精度渲染器。')
    if (data.length !== width * height * 4 || width > this.maxTextureSize || height > this.maxTextureSize) {
      throw new Error('高位深底图尺寸无效或超过 GPU 纹理上限。')
    }
    const gl = this.gl
    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture)
    this.sourceTexture = twgl.createTexture(this.tgl, {
      src: data, width, height, internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT,
      min: gl.NEAREST, mag: gl.NEAREST, wrap: gl.CLAMP_TO_EDGE, auto: false
    })
    this.width = width
    this.height = height
    const base = this.fbo('base', width, height)
    this.draw(this.programs.decode, base, { uSource: this.sourceTexture, uLinear: 1 })
    this.result = base
  }

  /**
   * 依次施加调整图层。imageLongSide 为“整图在当前渲染比例下的长边像素数”，
   * 用于把相对模糊半径换算成像素（分块导出时它大于当前块的尺寸）。
   */
  process(layers: RenderLayer[], imageLongSide: number): void {
    if (!this.sourceTexture) {
      throw new Error('尚未设置底图')
    }
    const usedMasks = new Set<string>()
    let input = this.fbo('base', this.width, this.height)
    let flip = false
    for (const layer of layers) {
      if (isIdentityParams(layer.params) || layer.mask?.empty) {
        if (layer.mask) usedMasks.add(layer.mask.key)
        continue
      }
      const output = this.fbo(flip ? 'pong' : 'ping', this.width, this.height)
      flip = !flip
      const p = layer.params
      const blurLarge = p.clarity !== 0
        ? this.blurredLuma(input, CLARITY_SIGMA_RATIO * imageLongSide, 'large')
        : this.dummyTexture
      const blurSmall = p.sharpen !== 0
        ? this.blurredLuma(input, Math.max(0.5, SHARPEN_SIGMA_RATIO * imageLongSide), 'small')
        : this.dummyTexture
      let maskTexture = this.dummyTexture
      if (layer.mask) {
        usedMasks.add(layer.mask.key)
        maskTexture = this.maskTexture(layer.mask)
      }
      this.draw(this.programs.adjust, output, {
        uSource: input.attachments[0],
        uMask: maskTexture,
        uBlurLarge: blurLarge,
        uBlurSmall: blurSmall,
        uUseMask: layer.mask ? 1 : 0,
        uExposure: p.exposure,
        uContrast: p.contrast,
        uHighlights: p.highlights,
        uShadows: p.shadows,
        uWhites: p.whites,
        uBlacks: p.blacks,
        uTemperature: p.temperature,
        uTint: p.tint,
        uVibrance: p.vibrance,
        uSaturation: p.saturation,
        uClarity: p.clarity,
        uSharpen: p.sharpen
      })
      input = output
    }
    for (const [key, texture] of this.maskTextures) {
      if (!usedMasks.has(key)) {
        this.gl.deleteTexture(texture)
        this.maskTextures.delete(key)
      }
    }
    this.result = input
  }

  /** 把结果按渲染尺寸画到自身画布上（预览用） */
  present(): void {
    const result = this.requireResult()
    if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
      this.canvas.width = this.width
      this.canvas.height = this.height
    }
    this.draw(this.programs.encode, null, {
      uSource: result.attachments[0],
      uOutToUv: scaleMatrix(1 / this.width, 1 / this.height),
      uOutSize: [this.width, this.height],
      uHighPrecision: this.highPrecision ? 1 : 0,
      uFlipY: 1
    })
  }

  /**
   * 按仿射变换重采样并读回 8 位 RGBA（导出用）。
   * @param outToSource 输出像素坐标 → 当前渲染区域内的像素坐标
   */
  readPixels(outW: number, outH: number, outToSource: Affine = [1, 0, 0, 0, 1, 0]): Uint8ClampedArray<ArrayBuffer> {
    const gl = this.gl
    const result = this.requireResult()
    const target = this.fbo('output', outW, outH, {
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      min: gl.NEAREST,
      mag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE
    })
    const [a, b, c, d, e, f] = outToSource
    const sw = this.width
    const sh = this.height
    // 列主序 mat3：uv = (M · (x, y, 1)) / 源尺寸
    const matrix = new Float32Array([a / sw, d / sh, 0, b / sw, e / sh, 0, c / sw, f / sh, 1])
    this.draw(this.programs.encode, target, {
      uSource: result.attachments[0],
      uOutToUv: matrix,
      uOutSize: [outW, outH],
      uHighPrecision: this.highPrecision ? 1 : 0,
      uFlipY: 0
    })
    const pixels = new Uint8Array(outW * outH * 4)
    gl.readPixels(0, 0, outW, outH, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    return new Uint8ClampedArray(pixels.buffer)
  }

  /** 在浮点目标完成裁剪、插值和 sRGB 编码，最后量化为 16 位 RGB。 */
  readPixels16(outW: number, outH: number, outToSource: Affine = [1, 0, 0, 0, 1, 0]): Uint16Array<ArrayBuffer> {
    if (!this.highPrecision) throw new Error('16 位导出需要高精度渲染器。')
    const gl = this.gl
    const target = this.fbo('output16', outW, outH)
    const [a, b, c, d, e, f] = outToSource
    const sw = this.width
    const sh = this.height
    this.draw(this.programs.encode, target, {
      uSource: this.requireResult().attachments[0],
      uOutToUv: new Float32Array([a / sw, d / sh, 0, b / sw, e / sh, 0, c / sw, f / sh, 1]),
      uOutSize: [outW, outH], uFlipY: 0, uHighPrecision: 1
    })
    const floats = new Float32Array(outW * outH * 4)
    gl.readPixels(0, 0, outW, outH, gl.RGBA, gl.FLOAT, floats)
    if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) throw new Error('高位深像素读取失败，请重试。')
    const pixels = new Uint16Array(outW * outH * 3)
    for (let p = 0; p < outW * outH; p++) {
      for (let channel = 0; channel < 3; channel++) {
        pixels[p * 3 + channel] = Math.round(Math.min(1, Math.max(0, floats[p * 4 + channel]!)) * 65535)
      }
    }
    return pixels
  }

  dispose(): void {
    const gl = this.gl
    for (const fbo of this.fbos.values()) {
      deleteFbo(gl, fbo)
    }
    this.fbos.clear()
    for (const texture of this.maskTextures.values()) {
      gl.deleteTexture(texture)
    }
    this.maskTextures.clear()
    if (this.sourceTexture) {
      gl.deleteTexture(this.sourceTexture)
      this.sourceTexture = null
    }
    gl.deleteTexture(this.dummyTexture)
    for (const program of Object.values(this.programs)) {
      gl.deleteProgram(program.program)
    }
  }

  private requireResult(): Fbo {
    if (!this.result) {
      throw new Error('尚未渲染任何内容')
    }
    return this.result
  }

  private draw(program: twgl.ProgramInfo, target: Fbo | null, uniforms: Record<string, unknown>): void {
    const gl = this.gl
    if (target) {
      twgl.bindFramebufferInfo(this.tgl, target)
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    }
    gl.useProgram(program.program)
    twgl.setBuffersAndAttributes(this.tgl, program, this.quad)
    twgl.setUniforms(program, uniforms)
    twgl.drawBufferInfo(this.tgl, this.quad, gl.TRIANGLES, 3)
  }

  /** 按名称缓存帧缓冲；尺寸变化时重建 */
  private fbo(name: string, width: number, height: number, attachment: twgl.AttachmentOptions = this.floatAttachment): Fbo {
    const existing = this.fbos.get(name)
    if (existing && existing.width === width && existing.height === height) {
      return existing
    }
    if (existing) {
      deleteFbo(this.gl, existing)
    }
    const fbo = twgl.createFramebufferInfo(this.tgl, [attachment], width, height)
    if (this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) !== this.gl.FRAMEBUFFER_COMPLETE) {
      deleteFbo(this.gl, fbo)
      throw new Error('无法分配调色缓冲，请关闭其他占用显存的应用后重试。')
    }
    this.fbos.set(name, fbo)
    return fbo
  }

  private maskTexture(mask: MaskTexture): WebGLTexture {
    const cached = this.maskTextures.get(mask.key)
    if (cached) {
      return cached
    }
    const gl = this.gl
    const floating = mask.data instanceof Float32Array
    const texture = twgl.createTexture(this.tgl, {
      src: mask.data,
      width: mask.width,
      height: mask.height,
      internalFormat: floating ? gl.R32F : gl.R8,
      format: gl.RED,
      type: floating ? gl.FLOAT : gl.UNSIGNED_BYTE,
      min: gl.LINEAR,
      mag: gl.LINEAR,
      wrap: gl.CLAMP_TO_EDGE,
      unpackAlignment: 1,
      auto: false
    })
    this.maskTextures.set(mask.key, texture)
    return texture
  }

  /**
   * 感知亮度的高斯模糊：先逐级 2 倍降采样直到 sigma 落到约 3 像素以内，再做可分离高斯，
   * 大半径模糊因此保持恒定开销；结果纹理以线性过滤放大采样。
   */
  private blurredLuma(input: Fbo, sigma: number, role: 'large' | 'small'): WebGLTexture {
    let level = this.fbo(`${role}-luma`, this.width, this.height)
    this.draw(this.programs.luma, level, { uSource: input.attachments[0] })

    let levelIndex = 0
    while (sigma * (level.width / this.width) > 3 && level.width > 8 && level.height > 8) {
      levelIndex++
      const next = this.fbo(`${role}-down-${levelIndex}`, Math.ceil(level.width / 2), Math.ceil(level.height / 2))
      this.draw(this.programs.downsample, next, { uSource: level.attachments[0] })
      level = next
    }

    const sx = sigma * level.width / this.width
    const sy = sigma * level.height / this.height
    if (Math.max(sx, sy) < 0.3) {
      return level.attachments[0] as WebGLTexture
    }
    const temp = this.fbo(`${role}-blur-h`, level.width, level.height)
    const out = this.fbo(`${role}-blur-v`, level.width, level.height)
    const kx = gaussianKernel(sx)
    const ky = gaussianKernel(sy)
    this.draw(this.programs.blur, temp, {
      uSource: level.attachments[0],
      uStep: [1 / level.width, 0],
      uRadius: kx.radius,
      uWeights: kx.weights
    })
    this.draw(this.programs.blur, out, {
      uSource: temp.attachments[0],
      uStep: [0, 1 / level.height],
      uRadius: ky.radius,
      uWeights: ky.weights
    })
    return out.attachments[0] as WebGLTexture
  }
}

/** 归一化的一维高斯核（只存中心和单侧） */
export function gaussianKernel(sigma: number): { radius: number, weights: Float32Array } {
  const radius = Math.min(MAX_BLUR_RADIUS, Math.max(1, Math.ceil(sigma * 3)))
  const weights = new Float32Array(MAX_BLUR_RADIUS + 1)
  let sum = 0
  for (let i = 0; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma))
    weights[i] = w
    sum += i === 0 ? w : 2 * w
  }
  for (let i = 0; i <= radius; i++) {
    weights[i] = weights[i]! / sum
  }
  return { radius, weights }
}

function scaleMatrix(sx: number, sy: number): Float32Array {
  return new Float32Array([sx, 0, 0, 0, sy, 0, 0, 0, 1])
}

function deleteFbo(gl: WebGL2RenderingContext, fbo: Fbo): void {
  gl.deleteFramebuffer(fbo.framebuffer)
  for (const attachment of fbo.attachments) {
    if (attachment instanceof WebGLTexture) {
      gl.deleteTexture(attachment)
    } else {
      gl.deleteRenderbuffer(attachment)
    }
  }
}
