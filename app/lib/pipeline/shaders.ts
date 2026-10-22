/**
 * 调色管线着色器（GLSL ES 3.0）。
 * 约定：中间纹理均为线性 RGB；纹理第 0 行对应图像第一行（顶部），只在输出到画布时翻转。
 */

export const FULLSCREEN_VERT = `#version 300 es
in vec2 position;
out vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const COMMON = `
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}
float perceptual(float l) {
  return pow(max(l, 1e-6), 1.0 / 2.2);
}
`

/** sRGB 显示源转线性；高位深线性源直接拷贝，避免重复 gamma。 */
export const DECODE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uSource;
uniform bool uLinear;
out vec4 outColor;
${COMMON}
void main() {
  vec3 c = texture(uSource, vUv).rgb;
  outColor = vec4(uLinear ? c : srgbToLinear(c), 1.0);
}
`

/** 线性 RGB → 感知亮度（存于 r 通道），作为清晰度/锐化的高斯模糊输入 */
export const LUMA_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uSource;
out vec4 outColor;
${COMMON}
void main() {
  outColor = vec4(perceptual(luminance(texture(uSource, vUv).rgb)), 0.0, 0.0, 1.0);
}
`

/** 2 倍降采样：目标像素中心落在 2×2 源像素的交点上，线性过滤即取四点平均 */
export const DOWNSAMPLE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uSource;
out vec4 outColor;
void main() {
  outColor = texture(uSource, vUv);
}
`

export const MAX_BLUR_RADIUS = 16

/** 可分离高斯模糊（单通道） */
export const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uSource;
uniform vec2 uStep;
uniform int uRadius;
uniform float uWeights[${MAX_BLUR_RADIUS + 1}];
out vec4 outColor;
void main() {
  float sum = texture(uSource, vUv).r * uWeights[0];
  for (int i = 1; i <= ${MAX_BLUR_RADIUS}; i++) {
    if (i > uRadius) break;
    vec2 offset = uStep * float(i);
    sum += (texture(uSource, vUv + offset).r + texture(uSource, vUv - offset).r) * uWeights[i];
  }
  outColor = vec4(sum, 0.0, 0.0, 1.0);
}
`

/**
 * 单个调整图层。顺序：白平衡 → 曝光 → 色阶/阴影高光/对比（感知亮度上）→ 清晰度/锐化 → 饱和度（OKLab）。
 * 亮度调整通过“新亮度/旧亮度”等比缩放 RGB，保持色相与饱和度；最后按区域蒙版与输入混合。
 */
export const ADJUST_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uSource;
uniform highp sampler2D uMask;
uniform highp sampler2D uBlurLarge;
uniform highp sampler2D uBlurSmall;
uniform bool uUseMask;
uniform float uExposure;
uniform bool uHdr;
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;
uniform float uTemperature;
uniform float uTint;
uniform float uVibrance;
uniform float uSaturation;
uniform float uClarity;
uniform float uSharpen;
out vec4 outColor;
${COMMON}

vec3 linearToOklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  vec3 rawLms = vec3(l, m, s);
  vec3 lms = uHdr ? sign(rawLms) * pow(abs(rawLms), vec3(1.0 / 3.0)) : pow(max(rawLms, 0.0), vec3(1.0 / 3.0));
  return vec3(
    0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
    1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
    0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z
  );
}

vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  vec3 lms = vec3(l * l * l, m * m * m, s * s * s);
  return vec3(
    4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
    -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
    -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z
  );
}

// 以 0.5 为中点的对称 S 曲线；a > 1 增强对比，a < 1 降低对比，a = 1 为恒等
float contrastCurve(float x, float a) {
  x = clamp(x, 0.0, 1.0);
  return x < 0.5 ? 0.5 * pow(2.0 * x, a) : 1.0 - 0.5 * pow(2.0 - 2.0 * x, a);
}

void main() {
  vec3 src = texture(uSource, vUv).rgb;
  vec3 c = src;

  // 白平衡：按 RGB 增益调整，再归一化使中性灰亮度不变
  float t = uTemperature / 100.0;
  float g = uTint / 100.0;
  vec3 gains = vec3(exp2(0.35 * t), exp2(-0.3 * g), exp2(-0.35 * t));
  c *= gains / luminance(gains);

  c *= exp2(uExposure);

  float lum = max(luminance(c), 1e-6);
  float p = perceptual(lum);
  if (uHdr) {
    // 参考白以上仍有高光权重，曝光域对比度不会把 HDR 压回 0–1。
    float ev = log2(lum / 0.18);
    float shadow = 1.0 - smoothstep(-4.0, 1.0, ev);
    float highlight = smoothstep(0.0, 4.0, ev);
    ev = ev * exp2(uContrast / 200.0)
      + uShadows / 100.0 * shadow * 2.0 + uHighlights / 100.0 * highlight * 2.0
      + uWhites / 100.0 * smoothstep(2.0, 5.0, ev)
      + uBlacks / 100.0 * (1.0 - smoothstep(-6.0, -2.0, ev));
    p = perceptual(0.18 * exp2(clamp(ev, -30.0, 30.0)));
  } else {

  // 黑白场
  float bp = -uBlacks / 100.0 * 0.12;
  float wp = 1.0 - uWhites / 100.0 * 0.12;
  p = (p - bp) / (wp - bp);

  // 阴影/高光：权重在 0 和 1 处为 0，不会翻转色调
  float pc = clamp(p, 0.0, 1.0);
  p += uShadows / 100.0 * 1.6 * pc * (1.0 - pc) * (1.0 - pc);
  pc = clamp(p, 0.0, 1.0);
  p += uHighlights / 100.0 * 1.6 * pc * pc * (1.0 - pc);

  // 对比度：只叠加曲线的增量，保留超出 1 的高光信息
  pc = clamp(p, 0.0, 1.0);
  p += contrastCurve(pc, exp2(uContrast / 100.0 * 1.2)) - pc;
  }

  // 清晰度与锐化：输入感知亮度减去其模糊版本得到细节层
  float pIn = perceptual(luminance(src));
  if (uClarity != 0.0) {
    float mid = uHdr ? 1.0 : 1.0 - pow(abs(2.0 * clamp(p, 0.0, 1.0) - 1.0), 2.0);
    p += uClarity / 100.0 * 0.8 * (pIn - texture(uBlurLarge, vUv).r) * mid;
  }
  if (uSharpen != 0.0) {
    p += uSharpen / 100.0 * 1.5 * (pIn - texture(uBlurSmall, vUv).r);
  }

  c *= pow(max(p, 0.0), 2.2) / lum;

  // 饱和度与自然饱和度（OKLab 色度）
  if (uSaturation != 0.0 || uVibrance != 0.0) {
    vec3 lab = linearToOklab(uHdr ? c : max(c, 0.0));
    float chroma = length(lab.yz);
    float vib = 1.0 + uVibrance / 100.0 * (1.0 - smoothstep(0.0, 0.25, chroma));
    lab.yz *= (1.0 + uSaturation / 100.0) * vib;
    c = oklabToLinear(lab);
  }

  float m = uUseMask ? texture(uMask, vUv).r : 1.0;
  outColor = vec4(mix(src, c, m), 1.0);
}
`

/**
 * 输出编码：按 uOutToUv（输出像素中心 → 源纹理 uv）重采样，实现裁剪与旋转，然后转回 8 位 sRGB。
 * uFlipY 用于直接画到画布（画布第 0 行在底部）。
 */
export const ENCODE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uSource;
uniform mat3 uOutToUv;
uniform vec2 uOutSize;
uniform bool uFlipY;
uniform bool uHighPrecision;
uniform bool uHdr;
uniform bool uOutputLinear;
out vec4 outColor;
${COMMON}
// 16 位输出使用浮点插值权重，避免硬件纹理过滤的子像素精度限制影响分块旋转边缘。
vec3 sampleSource(vec2 uv) {
  if (!uHighPrecision) return texture(uSource, uv).rgb;
  ivec2 size = textureSize(uSource, 0);
  vec2 p = uv * vec2(size) - 0.5;
  ivec2 lo = ivec2(floor(p));
  vec2 f = fract(p);
  ivec2 hi = size - 1;
  vec3 a = texelFetch(uSource, clamp(lo, ivec2(0), hi), 0).rgb;
  vec3 b = texelFetch(uSource, clamp(lo + ivec2(1, 0), ivec2(0), hi), 0).rgb;
  vec3 c = texelFetch(uSource, clamp(lo + ivec2(0, 1), ivec2(0), hi), 0).rgb;
  vec3 d = texelFetch(uSource, clamp(lo + ivec2(1, 1), ivec2(0), hi), 0).rgb;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  vec2 outPx = vec2(vUv.x, uFlipY ? 1.0 - vUv.y : vUv.y) * uOutSize;
  vec2 uv = (uOutToUv * vec3(outPx, 1.0)).xy;
  vec3 c = sampleSource(uv);
  if (uOutputLinear) { outColor = vec4(c, 1.0); return; }
  if (uHdr) {
    float y = max(luminance(c), 0.0);
    float mapped = y <= 0.5 ? y : 1.0 - 0.5 * exp(-(y - 0.5) / 0.5);
    c *= mapped / max(y, 1e-8);
    float saturation = 1.0;
    for (int i = 0; i < 3; i++) {
      float d = c[i] - mapped;
      if (d > 0.0) saturation = min(saturation, (1.0 - mapped) / d);
      if (d < 0.0) saturation = min(saturation, -mapped / d);
    }
    c = mix(vec3(mapped), c, clamp(saturation, 0.0, 1.0));
  }
  outColor = vec4(linearToSrgb(clamp(c, 0.0, 1.0)), 1.0);
}
`
