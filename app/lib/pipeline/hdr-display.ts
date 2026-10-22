/// <reference types="@webgpu/types" />

/** 独立 DOM 画布：不能再经 Canvas2D / Konva 拷贝，否则会丢失 HDR。 */
export class HdrDisplay {
  private texture: GPUTexture | undefined
  private group: GPUBindGroup | undefined
  private constructor(readonly canvas: HTMLCanvasElement, private device: GPUDevice, private context: GPUCanvasContext, private pipeline: GPURenderPipeline) {}

  static async create(onLost: () => void): Promise<HdrDisplay> {
    if (!navigator.gpu) throw new Error('当前环境不支持 WebGPU')
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) throw new Error('未找到支持的 GPU')
    const device = await adapter.requestDevice()
    let display: HdrDisplay | undefined
    try {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('webgpu')!
      device.pushErrorScope('validation')
      context.configure({ device, format: 'rgba16float', colorSpace: 'display-p3', alphaMode: 'opaque', toneMapping: { mode: 'extended' } })
      if (context.getConfiguration()?.toneMapping?.mode !== 'extended') throw new Error('当前环境不支持 HDR 画布')
      const module = device.createShaderModule({ code: `
        @group(0) @binding(0) var source: texture_2d<f32>;
        @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
          let positions = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
          return vec4f(positions[i], 0., 1.);
        }
        @fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
          let c = textureLoad(source, vec2i(pos.xy), 0).rgb;
          // Extended linear sRGB → Display P3 D65, then extended sRGB transfer.
          let p3 = vec3f(dot(c, vec3f(.82259287, .17753395, 0.)), dot(c, vec3f(.03319951, .9667835, 0.)), dot(c, vec3f(.01708535, .07239572, .91030148)));
          return vec4f(p3, 1.);
        }` })
      const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] })
      const pipeline = await device.createRenderPipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list' }
      })
      const validation = await device.popErrorScope()
      if (validation) throw new Error(validation.message)
      display = new HdrDisplay(canvas, device, context, pipeline)
      void device.lost.then(onLost)
      device.addEventListener('uncapturederror', onLost)
      return display
    } catch (error) {
      display?.dispose()
      device.destroy()
      throw error
    }
  }

  present(data: Float32Array<ArrayBuffer>, width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height || !this.texture) {
      this.texture?.destroy()
      this.canvas.width = width
      this.canvas.height = height
      this.texture = this.device.createTexture({ size: [width, height], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
      this.group = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.texture.createView() }] })
    }
    this.device.queue.writeTexture({ texture: this.texture }, data, { bytesPerRow: width * 16 }, [width, height])
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, this.group!)
    pass.draw(3)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }

  dispose(): void {
    this.context.unconfigure()
    this.texture?.destroy()
    this.device.destroy()
  }
}
