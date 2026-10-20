<script setup lang="ts">
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { VueKonvaRef } from 'vue-konva'
import type { EditorView } from '~/composables/useEditorRenderer'
import { defaultCrop } from '~/lib/geometry/crop'
import type { MaskSpec, NormLine, NormRect } from '~/lib/types'
import { useEditorStore } from '~/stores/editor'
import { useInpaintStore } from '~/stores/inpaint'

const props = defineProps<{ view: EditorView }>()
const editor = useEditorStore()
const inpaint = useInpaintStore()

/** 画布叠加层画在照片上，不随明暗主题变化：手柄用系统蓝，建议区域预览用系统黄 */
const ACCENT = '#0a84ff'
const HOVER = '#ffd60a'
const MIN_SCALE = 0.02
const MAX_SCALE = 32
/** 按钮、快捷键与进入/退出裁剪触发的视角过渡时长；滚轮缩放和拖动平移始终直接跟手 */
const VIEW_TWEEN_MS = 280
/** 按下与松开相距不超过这个屏幕距离，就算一次单击而不是拖动 */
const CLICK_SLOP = 4

const container = ref<HTMLDivElement | null>(null)
const layerRef = ref<VueKonvaRef<Konva.Layer> | null>(null)
const rotGroupRef = ref<VueKonvaRef<Konva.Group> | null>(null)
const regionRef = ref<VueKonvaRef<Konva.Rect> | null>(null)
const regionTrRef = ref<VueKonvaRef<Konva.Transformer> | null>(null)
const cropRef = ref<VueKonvaRef<Konva.Rect> | null>(null)
const cropTrRef = ref<VueKonvaRef<Konva.Transformer> | null>(null)

const size = reactive({ width: 0, height: 0 })
const vp = reactive({ scale: 1, x: 0, y: 0 })
let fitted = false

const W = computed(() => editor.project?.width ?? 1)
const H = computed(() => editor.project?.height ?? 1)
const longSide = computed(() => Math.max(W.value, H.value))
const crop = computed(() => editor.doc.crop)
const cropMode = computed(() => editor.tool === 'crop')
const cropDraft = computed(() => crop.value ?? defaultCrop())
const comparing = computed(() => editor.compareOriginal)

/** 让描边、手柄在任意缩放下保持固定的屏幕尺寸 */
const px = (n: number) => n / vp.scale

// ---------- 视图 ----------

type View = { scale: number, x: number, y: number }

let tweenFrame = 0
/** 过渡进行中时的终点；连续点击放大会在终点上累加，而不是在半途的视角上 */
let tweenTarget: View | null = null

function stopTween() {
  cancelAnimationFrame(tweenFrame)
  tweenTarget = null
}

/** 视口中心对应的图像坐标 */
function centerOf(view: View) {
  return { x: (size.width / 2 - view.x) / view.scale, y: (size.height / 2 - view.y) / view.scale }
}

/**
 * 切换到目标视角。过渡时缩放按对数插值（放大、缩小的观感速度一致），视口中心对应的图像点线性移动，
 * 两者合成后缩放中心不会漂移；用户要求减少动态效果时直接到位
 */
function setView(target: View, animate: boolean) {
  stopTween()
  if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    Object.assign(vp, target)
    return
  }
  tweenTarget = target
  const fromScale = vp.scale
  const from = centerOf(vp)
  const to = centerOf(target)
  // 起点取第一帧的时间戳：帧时间戳可能早于触发过渡的点击，用 performance.now() 会算出负进度、先倒退一下
  let start: number | null = null
  const step = (now: number) => {
    start ??= now
    const t = Math.min(1, (now - start) / VIEW_TWEEN_MS)
    const k = t >= 1 ? 1 : 1 - 2 ** (-10 * t)
    const scale = fromScale * (target.scale / fromScale) ** k
    vp.scale = scale
    vp.x = size.width / 2 - (from.x + (to.x - from.x) * k) * scale
    vp.y = size.height / 2 - (from.y + (to.y - from.y) * k) * scale
    if (t < 1) {
      tweenFrame = requestAnimationFrame(step)
    } else {
      tweenTarget = null
      Object.assign(vp, target)
    }
  }
  tweenFrame = requestAnimationFrame(step)
}

function fit(animate = false) {
  if (!size.width || !size.height) {
    return
  }
  const target = !cropMode.value && crop.value
    ? { x: crop.value.rect.x * W.value, y: crop.value.rect.y * H.value, w: crop.value.rect.w * W.value, h: crop.value.rect.h * H.value }
    : { x: 0, y: 0, w: W.value, h: H.value }
  const margin = 24
  const scale = Math.max(MIN_SCALE, Math.min((size.width - margin * 2) / target.w, (size.height - margin * 2) / target.h))
  setView({
    scale,
    x: size.width / 2 - (target.x + target.w / 2) * scale,
    y: size.height / 2 - (target.y + target.h / 2) * scale
  }, animate)
  fitted = true
}

function zoomAt(factor: number, cx: number, cy: number, animate = false) {
  const base = tweenTarget ?? { scale: vp.scale, x: vp.x, y: vp.y }
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, base.scale * factor))
  const wx = (cx - base.x) / base.scale
  const wy = (cy - base.y) / base.scale
  setView({ scale, x: cx - wx * scale, y: cy - wy * scale }, animate)
}

function zoomBy(factor: number) {
  zoomAt(factor, size.width / 2, size.height / 2, true)
}

/** 原图 1 像素对应屏幕 1 像素 */
function actualSize() {
  zoomAt(1 / (tweenTarget ?? vp).scale, size.width / 2, size.height / 2, true)
}

// 对外的视图操作都由按钮或快捷键触发，带过渡
defineExpose({ fit: () => fit(true), zoomBy, actualSize })

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry) return
    size.width = entry.contentRect.width
    size.height = entry.contentRect.height
    if (!fitted && props.view.ready.value) fit()
  })
  if (container.value) {
    resizeObserver.observe(container.value)
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('pointerup', finishPointer)
})

onBeforeUnmount(() => {
  stopTween()
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('pointerup', finishPointer)
})

// 进入裁剪时镜头拉远露出整张原图，完成裁剪时再推近到裁剪框
watch(cropMode, () => nextTick(() => fit(true)))

// 工程与渲染器就绪后才知道图像尺寸，此时再做首次自适应
watch(() => props.view.ready.value, (ready) => {
  if (ready) {
    nextTick(fit)
  }
}, { immediate: true })

// 预览结果或叠加层更新后重绘图层（画布对象不变，只是内容变化）
watch(
  [() => props.view.frame.value, () => props.view.overlayFrame.value, comparing],
  () => layerRef.value?.getNode().batchDraw()
)

const stageConfig = computed(() => ({ width: size.width, height: size.height }))
const worldConfig = computed(() => ({ x: vp.x, y: vp.y, scaleX: vp.scale, scaleY: vp.scale }))
const clipConfig = computed(() => {
  const c = crop.value
  // Konva 10 只要 clipWidth/clipHeight 为数字（包括 0）就会启用裁剪，无裁剪时必须为 undefined
  if (cropMode.value || !c) {
    return { clipX: undefined, clipY: undefined, clipWidth: undefined, clipHeight: undefined }
  }
  return { clipX: c.rect.x * W.value, clipY: c.rect.y * H.value, clipWidth: c.rect.w * W.value, clipHeight: c.rect.h * H.value }
})
const rotConfig = computed(() => ({
  x: W.value / 2,
  y: H.value / 2,
  offsetX: W.value / 2,
  offsetY: H.value / 2,
  rotation: crop.value?.angle ?? 0
}))
const photoConfig = computed(() => {
  void props.view.frame.value
  return {
    image: comparing.value ? props.view.originalPreview.value : props.view.displayCanvas.value,
    width: W.value,
    height: H.value,
    name: 'photo'
  }
})
const overlayConfig = computed(() => ({
  image: props.view.overlayCanvas.value,
  width: W.value,
  height: H.value,
  visible: props.view.overlayVisible.value && !comparing.value,
  listening: false
}))

// ---------- 选中图层的区域 ----------

const layer = computed(() => editor.selectedLayer)
const mask = computed<MaskSpec | null>(() => layer.value?.mask ?? null)
const regionLocked = computed(() => {
  const l = layer.value
  return !!l && l.kind === 'generative' && (!!l.result || inpaint.isRunning(l.id))
})
const showRegion = computed(() => !!mask.value && !cropMode.value && !comparing.value)
const regionEditable = computed(() => showRegion.value && editor.tool === 'move' && !regionLocked.value)
const isBoxShape = computed(() => mask.value?.shape === 'rect' || mask.value?.shape === 'ellipse')

function rectPx(rect: NormRect) {
  return { x: rect.x * W.value, y: rect.y * H.value, width: rect.w * W.value, height: rect.h * H.value }
}

const outline = (color: string, dashed = true) => ({
  stroke: color,
  strokeWidth: 1.5,
  strokeScaleEnabled: false,
  dash: dashed ? [px(6), px(4)] : undefined,
  shadowColor: 'black',
  shadowBlur: 2,
  shadowOpacity: 0.7,
  shadowForStrokeEnabled: true
})

const regionRectConfig = computed(() => {
  const m = mask.value!
  return {
    ...rectPx(m.rect),
    ...outline(regionLocked.value ? '#d4d4d8' : '#ffffff', m.shape === 'rect'),
    // 椭圆时外框只作为拖拽与变形的代理，不显示描边
    strokeEnabled: m.shape === 'rect',
    fill: 'rgba(0,0,0,0.001)',
    draggable: regionEditable.value,
    listening: regionEditable.value,
    name: 'region'
  }
})

function ellipseConfigOf(rect: NormRect, color: string, dashed = true) {
  const r = rectPx(rect)
  return {
    x: r.x + r.width / 2,
    y: r.y + r.height / 2,
    radiusX: r.width / 2,
    radiusY: r.height / 2,
    ...outline(color, dashed),
    listening: false
  }
}

const regionEllipseConfig = computed(() => ellipseConfigOf(mask.value!.rect, regionLocked.value ? '#d4d4d8' : '#ffffff'))

const regionTrConfig = computed(() => ({
  rotateEnabled: false,
  keepRatio: false,
  flipEnabled: false,
  ignoreStroke: true,
  anchorSize: 9,
  anchorCornerRadius: 2,
  anchorStroke: ACCENT,
  anchorFill: '#ffffff',
  borderStroke: ACCENT,
  borderDash: [4, 3]
}))

watch(
  [regionEditable, isBoxShape, () => layer.value?.id, cropMode],
  async () => {
    await nextTick()
    const tr = regionTrRef.value?.getNode()
    const node = regionRef.value?.getNode()
    tr?.nodes(regionEditable.value && isBoxShape.value && node ? [node] : [])
    tr?.getLayer()?.batchDraw()
  },
  { immediate: true, flush: 'post' }
)

function clampRect(rect: NormRect): NormRect {
  const w = Math.min(1, Math.max(0.005, rect.w))
  const h = Math.min(1, Math.max(0.005, rect.h))
  return { x: Math.min(1 - w, Math.max(0, rect.x)), y: Math.min(1 - h, Math.max(0, rect.y)), w, h }
}

/** 把 Konva 的缩放折算回宽高，返回归一化矩形 */
function readRectNode(node: Konva.Node): NormRect {
  const w = node.width() * node.scaleX()
  const h = node.height() * node.scaleY()
  node.setAttrs({ scaleX: 1, scaleY: 1, width: w, height: h })
  return { x: node.x() / W.value, y: node.y() / H.value, w: w / W.value, h: h / H.value }
}

function onRegionChange(e: KonvaEventObject<Event>) {
  const l = layer.value
  if (!l) return
  editor.updateMask(l.id, { rect: clampRect(readRectNode(e.target)) }, `region:${l.id}`)
}

// 线性渐变：起点/终点手柄与两条边界参考线
const linePx = computed(() => {
  const l = mask.value!.line
  return { x0: l.x0 * W.value, y0: l.y0 * H.value, x1: l.x1 * W.value, y1: l.y1 * H.value }
})

function guideAt(x: number, y: number) {
  const { x0, y0, x1, y1 } = linePx.value
  const len = Math.hypot(x1 - x0, y1 - y0) || 1
  const nx = -(y1 - y0) / len
  const ny = (x1 - x0) / len
  const reach = longSide.value * 2
  return [x - nx * reach, y - ny * reach, x + nx * reach, y + ny * reach]
}

const lineConfigs = computed(() => {
  const { x0, y0, x1, y1 } = linePx.value
  return {
    axis: { points: [x0, y0, x1, y1], ...outline('#ffffff'), listening: false },
    start: { points: guideAt(x0, y0), ...outline('#ffffff', false), listening: false },
    end: { points: guideAt(x1, y1), ...outline('#ffffff'), listening: false }
  }
})

const handleBase = computed(() => ({
  radius: px(7),
  fill: '#ffffff',
  stroke: ACCENT,
  strokeWidth: 2,
  strokeScaleEnabled: false,
  draggable: regionEditable.value,
  listening: regionEditable.value
}))

function clampLineValue(v: number) {
  return Math.min(2, Math.max(-1, v))
}

function onLineHandle(which: 'start' | 'end' | 'center', e: KonvaEventObject<DragEvent>) {
  const l = layer.value
  if (!l) return
  const pos = e.target.position()
  const current = l.mask.line
  let line: NormLine
  if (which === 'start') {
    line = { ...current, x0: clampLineValue(pos.x / W.value), y0: clampLineValue(pos.y / H.value) }
  } else if (which === 'end') {
    line = { ...current, x1: clampLineValue(pos.x / W.value), y1: clampLineValue(pos.y / H.value) }
  } else {
    const dx = pos.x / W.value - (current.x0 + current.x1) / 2
    const dy = pos.y / H.value - (current.y0 + current.y1) / 2
    line = { x0: current.x0 + dx, y0: current.y0 + dy, x1: current.x1 + dx, y1: current.y1 + dy }
  }
  editor.updateMask(l.id, { line }, `region:${l.id}`)
}

const onLineStart = (e: KonvaEventObject<DragEvent>) => onLineHandle('start', e)
const onLineEnd = (e: KonvaEventObject<DragEvent>) => onLineHandle('end', e)
const onLineCenter = (e: KonvaEventObject<DragEvent>) => onLineHandle('center', e)

// 悬停建议时的区域提示
const hoverConfig = computed(() => {
  const m = editor.hoverMask
  if (!m || cropMode.value) return null
  if (m.shape === 'linear') {
    const l = m.line
    return { kind: 'line' as const, config: { points: [l.x0 * W.value, l.y0 * H.value, l.x1 * W.value, l.y1 * H.value], ...outline(HOVER), listening: false } }
  }
  if (m.shape === 'ellipse') {
    return { kind: 'ellipse' as const, config: ellipseConfigOf(m.rect, HOVER) }
  }
  if (m.shape === 'rect') {
    return { kind: 'rect' as const, config: { ...rectPx(m.rect), ...outline(HOVER), listening: false } }
  }
  return null
})

// ---------- 画笔 ----------

const brushActive = computed(() =>
  (editor.tool === 'brush' || editor.tool === 'erase') && !!layer.value && !regionLocked.value && !comparing.value)
const brushRadiusPx = computed(() => editor.brush.radius * longSide.value)
/** 指针在舞台中的屏幕坐标：笔刷圆圈画在裁剪与旋转之外，指针移出裁剪框后圆圈仍然跟手 */
const pointer = ref<{ x: number, y: number } | null>(null)
const liveStroke = ref<number[] | null>(null)

const cursorConfigs = computed(() => {
  const p = pointer.value
  if (!p) return null
  const radius = brushRadiusPx.value * vp.scale
  const base = { x: p.x, y: p.y, listening: false }
  return {
    outer: { ...base, radius, stroke: '#ffffff', strokeWidth: 1.5, shadowColor: 'black', shadowBlur: 2, shadowOpacity: 0.8, shadowForStrokeEnabled: true },
    inner: { ...base, radius: radius * Math.max(0.02, editor.brush.hardness), stroke: '#ffffff', strokeWidth: 1, dash: [3, 3], opacity: 0.7 }
  }
})

const liveStrokeConfig = computed(() => ({
  points: liveStroke.value ?? [],
  stroke: editor.tool === 'erase' ? 'rgba(96,165,250,0.55)' : 'rgba(239,68,68,0.55)',
  strokeWidth: brushRadiusPx.value * 2,
  lineCap: 'round',
  lineJoin: 'round',
  listening: false
}))

function localPointer(): { x: number, y: number } | null {
  return rotGroupRef.value?.getNode().getRelativePointerPosition() ?? null
}

// ---------- 指针交互：平移 / 画笔 ----------

/** blank：主键按在照片之外的空白处，松开时没有拖动就是一次「点空白处」 */
let panning: { startX: number, startY: number, vpX: number, vpY: number, blank: boolean } | null = null
const isPanning = ref(false)
const spaceDown = ref(false)

/** 照片之外的空白处（舞台本身）；有裁剪时被裁掉的部分也算 */
function isBlank(target: Konva.Node): boolean {
  return target.getType() === 'Stage'
}

function isBackground(target: Konva.Node): boolean {
  return isBlank(target) || target.name() === 'photo'
}

function onPointerDown(e: KonvaEventObject<PointerEvent>) {
  const evt = e.evt
  // 中键、空格是明确的平移手势，不会被当作单击
  const explicitPan = evt.button === 1 || spaceDown.value
  if (explicitPan || (evt.button === 0 && !brushActive.value && isBackground(e.target))) {
    stopTween()
    panning = { startX: evt.clientX, startY: evt.clientY, vpX: vp.x, vpY: vp.y, blank: !explicitPan && isBlank(e.target) }
    isPanning.value = true
    return
  }
  if (brushActive.value && evt.button === 0) {
    const p = localPointer()
    if (p) {
      liveStroke.value = [p.x, p.y]
    }
  }
}

function onPointerMove(e: KonvaEventObject<PointerEvent>) {
  if (panning) {
    vp.x = panning.vpX + e.evt.clientX - panning.startX
    vp.y = panning.vpY + e.evt.clientY - panning.startY
    return
  }
  if (!brushActive.value) {
    pointer.value = null
    return
  }
  pointer.value = e.target.getStage()?.getPointerPosition() ?? null
  const p = localPointer()
  const stroke = liveStroke.value
  if (stroke && p) {
    const lx = stroke[stroke.length - 2]!
    const ly = stroke[stroke.length - 1]!
    if (Math.hypot(p.x - lx, p.y - ly) >= Math.max(1, brushRadiusPx.value * 0.08)) {
      stroke.push(p.x, p.y)
    }
  }
}

function finishPointer(e: PointerEvent) {
  const pan = panning
  panning = null
  isPanning.value = false
  // 单击照片外的空白处取消选中图层。只在选择工具下生效：画笔要允许从照片外起笔，裁剪时选中的图层本就不显示
  if (pan?.blank && editor.tool === 'move' && Math.hypot(e.clientX - pan.startX, e.clientY - pan.startY) <= CLICK_SLOP) {
    editor.selectedLayerId = null
  }
  const stroke = liveStroke.value
  const l = layer.value
  liveStroke.value = null
  if (!stroke || !l) {
    return
  }
  const round = (v: number) => Math.round(v * 1e5) / 1e5
  editor.addStroke(l.id, {
    mode: editor.tool === 'erase' ? 'erase' : 'add',
    radius: editor.brush.radius,
    hardness: editor.brush.hardness,
    points: stroke.map((v, i) => round(i % 2 === 0 ? v / W.value : v / H.value))
  })
}

function onWheel(e: KonvaEventObject<WheelEvent>) {
  e.evt.preventDefault()
  const stage = e.target.getStage()
  const p = stage?.getPointerPosition()
  if (!p) return
  const factor = Math.exp(-e.evt.deltaY * (e.evt.ctrlKey ? 0.01 : 0.0015))
  // 滚轮直接跟手：打断进行中的过渡，从当前看到的视角继续缩放
  stopTween()
  zoomAt(factor, p.x, p.y)
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

function onKeyDown(e: KeyboardEvent) {
  if (e.code === 'Space' && !isTyping(e.target)) {
    spaceDown.value = true
    e.preventDefault()
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space') {
    spaceDown.value = false
  }
}

const cursor = computed(() => {
  if (isPanning.value) return 'grabbing'
  if (spaceDown.value) return 'grab'
  // 不能用 none 把系统光标藏起来：隐藏光标会让桌面端的鼠标在画布边缘被拽回容器内，圆圈只负责标出笔刷范围
  if (brushActive.value) return 'crosshair'
  return 'default'
})

// ---------- 裁剪 ----------

const cropPx = computed(() => rectPx(cropDraft.value.rect))

const cropRectConfig = computed(() => ({
  ...cropPx.value,
  stroke: '#ffffff',
  strokeWidth: 1.5,
  strokeScaleEnabled: false,
  fill: 'rgba(0,0,0,0.001)',
  draggable: true,
  name: 'crop'
}))

const cropDimConfigs = computed(() => {
  const r = cropPx.value
  const big = longSide.value * 10
  const base = { fill: 'rgba(0,0,0,0.55)', listening: false }
  return [
    { ...base, x: -big, y: -big, width: W.value + 2 * big, height: big + r.y },
    { ...base, x: -big, y: r.y + r.height, width: W.value + 2 * big, height: big + H.value - r.y - r.height },
    { ...base, x: -big, y: r.y, width: big + r.x, height: r.height },
    { ...base, x: r.x + r.width, y: r.y, width: big + W.value - r.x - r.width, height: r.height }
  ]
})

const cropGridConfigs = computed(() => {
  const r = cropPx.value
  const base = { stroke: 'rgba(255,255,255,0.45)', strokeWidth: 1, strokeScaleEnabled: false, listening: false }
  return [1, 2].flatMap(i => [
    { ...base, points: [r.x + r.width * i / 3, r.y, r.x + r.width * i / 3, r.y + r.height] },
    { ...base, points: [r.x, r.y + r.height * i / 3, r.x + r.width, r.y + r.height * i / 3] }
  ])
})

const cropTrConfig = computed(() => ({
  rotateEnabled: false,
  flipEnabled: false,
  ignoreStroke: true,
  keepRatio: editor.cropAspect !== null,
  enabledAnchors: editor.cropAspect !== null
    ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
    : ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right'],
  anchorSize: 10,
  anchorStroke: ACCENT,
  anchorFill: '#ffffff',
  borderStroke: ACCENT,
  boundBoxFunc: (oldBox: { width: number, height: number }, newBox: { width: number, height: number }) =>
    newBox.width < 24 || newBox.height < 24 ? oldBox : newBox
}))

watch(
  cropMode,
  async () => {
    await nextTick()
    const tr = cropTrRef.value?.getNode()
    const node = cropRef.value?.getNode()
    tr?.nodes(cropMode.value && node ? [node] : [])
    tr?.getLayer()?.batchDraw()
  },
  { immediate: true, flush: 'post' }
)

function onCropChange(e: KonvaEventObject<Event>) {
  const rect = readRectNode(e.target)
  editor.setCrop({ rect, angle: cropDraft.value.angle }, 'crop-rect')
}
</script>

<template>
  <div
    ref="container"
    class="relative size-full overflow-hidden bg-deep select-none"
    :style="{ cursor }"
    @pointerleave="pointer = null"
  >
    <!-- 照片第一次落到画布上时合焦：这是打开工程时唯一的一段编排动效 -->
    <v-stage
      v-if="view.ready.value && size.width > 0"
      :config="stageConfig"
      class="motion-safe:animate-photo-focus motion-reduce:animate-[emerge_200ms_var(--ease-out)]"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
    >
      <v-layer ref="layerRef">
        <v-group :config="worldConfig">
          <v-group :config="clipConfig">
            <v-group
              ref="rotGroupRef"
              :config="rotConfig"
            >
              <v-image :config="photoConfig" />
              <v-image :config="overlayConfig" />

              <template v-if="showRegion && mask">
                <template v-if="isBoxShape">
                  <v-ellipse
                    v-if="mask.shape === 'ellipse'"
                    :config="regionEllipseConfig"
                  />
                  <v-rect
                    ref="regionRef"
                    :config="regionRectConfig"
                    @dragmove="onRegionChange"
                    @transform="onRegionChange"
                  />
                </template>
                <template v-else-if="mask.shape === 'linear'">
                  <v-line :config="lineConfigs.start" />
                  <v-line :config="lineConfigs.end" />
                  <v-line :config="lineConfigs.axis" />
                  <v-circle
                    :config="{ ...handleBase, x: (linePx.x0 + linePx.x1) / 2, y: (linePx.y0 + linePx.y1) / 2, radius: px(5), fill: ACCENT, stroke: '#ffffff' }"
                    @dragmove="onLineCenter"
                  />
                  <v-circle
                    :config="{ ...handleBase, x: linePx.x0, y: linePx.y0 }"
                    @dragmove="onLineStart"
                  />
                  <v-circle
                    :config="{ ...handleBase, x: linePx.x1, y: linePx.y1, fill: '#18181b' }"
                    @dragmove="onLineEnd"
                  />
                </template>
              </template>

              <template v-if="hoverConfig">
                <v-rect
                  v-if="hoverConfig.kind === 'rect'"
                  :config="hoverConfig.config"
                />
                <v-ellipse
                  v-else-if="hoverConfig.kind === 'ellipse'"
                  :config="hoverConfig.config"
                />
                <v-line
                  v-else
                  :config="hoverConfig.config"
                />
              </template>

              <v-line
                v-if="liveStroke"
                :config="liveStrokeConfig"
              />
            </v-group>
          </v-group>

          <template v-if="cropMode">
            <v-rect
              v-for="(config, i) in cropDimConfigs"
              :key="`dim-${i}`"
              :config="config"
            />
            <v-line
              v-for="(config, i) in cropGridConfigs"
              :key="`grid-${i}`"
              :config="config"
            />
            <v-rect
              ref="cropRef"
              :config="cropRectConfig"
              @dragmove="onCropChange"
              @transform="onCropChange"
            />
          </template>
        </v-group>

        <v-transformer
          ref="regionTrRef"
          :config="regionTrConfig"
        />
        <v-transformer
          ref="cropTrRef"
          :config="cropTrConfig"
        />

        <template v-if="brushActive && cursorConfigs">
          <v-circle :config="cursorConfigs.outer" />
          <v-circle :config="cursorConfigs.inner" />
        </template>
      </v-layer>
    </v-stage>

    <div
      v-if="!view.ready.value"
      class="absolute inset-0 flex items-center justify-center text-sm text-muted"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="mr-2 size-4 animate-spin"
      />
      正在加载图像…
    </div>
    <div
      v-if="comparing"
      class="pointer-events-none absolute top-3 left-3 rounded-lg bg-deep/80 px-2.5 py-1 text-xs font-medium text-highlighted ring ring-default backdrop-blur-xl"
    >
      原图
    </div>
    <div
      v-if="view.error.value"
      role="alert"
      class="absolute inset-x-3 bottom-3 flex items-start gap-2 rounded-lg bg-deep/80 px-3 py-2 text-xs text-highlighted ring ring-default backdrop-blur-xl"
    >
      <UIcon
        name="i-lucide-circle-alert"
        class="size-4 shrink-0 text-error"
      />
      渲染出错：{{ view.error.value }}
    </div>
  </div>
</template>
