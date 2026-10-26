/**
 * 原型阶段的合成照片占位。
 *
 * 为什么不用真实照片：真实照片在作者设备的 IndexedDB 里，原型不得读取。
 * 这里用确定性生成的 SVG 色块占位，同一个照片 ID 永远得到同一张图，
 * 便于截图比对，也不会让人误以为这是真实回忆。
 */

const PALETTES: [string, string, string][] = [
  ['#F7C79C', '#DE7F53', '#8E4028'],
  ['#F8DDB4', '#DFA65C', '#84521F'],
  ['#F4C6BC', '#D07F86', '#79374A'],
  ['#D5E2D2', '#8CB094', '#3C6049'],
  ['#C9DAE7', '#7B9FB8', '#345066'],
  ['#E8D2E7', '#AC83B9', '#553567'],
  ['#EDD7BC', '#C1936B', '#654429'],
  ['#F5C39F', '#D07A4F', '#6E3423'],
  ['#DFE3C9', '#A5B27A', '#4A5533'],
  ['#F3C8CB', '#C97682', '#6E303C'],
]

/** 字符串散列，保证同一 ID 稳定取色 */
export function hashSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function rng(seed: number) {
  let s = seed || 1
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export interface PlaceholderOptions {
  width?: number
  height?: number
  /** 圆形头像 */
  round?: boolean
  /** 减少元素数量，用于列表缩略图 */
  simple?: boolean
}

/**
 * 生成一张确定性的抽象占位图。
 * 不是照片，只是让版面有真实的色块层次与比例。
 */
export function placeholderImage(seed: string, opts: PlaceholderOptions = {}): string {
  const w = opts.width ?? 900
  const h = opts.height ?? 1200
  const rand = rng(hashSeed(seed))
  const [c0, c1, c2] = PALETTES[hashSeed(seed) % PALETTES.length]

  const blobs = Array.from({ length: opts.simple ? 2 : 3 }, () => {
    const cx = Math.round(rand() * w)
    const cy = Math.round(rand() * h)
    const r = Math.round((0.22 + rand() * 0.3) * Math.min(w, h))
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#bokeh)" />`
  }).join('')

  const band = `<g opacity="0.5">
<ellipse cx="${Math.round(w * 0.68)}" cy="${Math.round(h * 0.24)}" rx="${Math.round(w * 0.52)}" ry="${Math.round(
        h * 0.3,
      )}" fill="url(#bokeh)" />
<ellipse cx="${Math.round(w * 0.24)}" cy="${Math.round(h * 0.72)}" rx="${Math.round(w * 0.42)}" ry="${Math.round(
        h * 0.26,
        )}" fill="url(#bokeh)" />
</g>`

  const hy = 0.6 + rand() * 0.2
  const horizon = `<path d="M0 ${Math.round(h * hy)} Q ${Math.round(w * 0.3)} ${Math.round(
        h * (hy - 0.06),
      )} ${Math.round(w * 0.6)} ${Math.round(h * (hy + 0.03))} T ${w} ${Math.round(
        h * (hy - 0.04),
      )} L${w} ${h} L0 ${h} Z" fill="#231610" opacity="0.18" />
<path d="M0 ${Math.round(h * hy)} Q ${Math.round(w * 0.3)} ${Math.round(
        h * (hy - 0.06),
      )} ${Math.round(w * 0.6)} ${Math.round(h * (hy + 0.03))} T ${w} ${Math.round(
        h * (hy - 0.04),
      )}" fill="none" stroke="#FFFFFF" stroke-opacity="0.14" stroke-width="${Math.max(1, Math.round(w / 500))}" />`

  const leak = `<rect x="${Math.round(-w * 0.3)}" y="${Math.round(h * 0.1)}" width="${Math.round(
        w * 1.6,
      )}" height="${Math.round(h * 0.16)}" fill="url(#leak)" opacity="0.22" transform="rotate(-14 ${Math.round(
        w / 2,
      )} ${Math.round(h / 2)})" />`

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${c0}"/><stop offset="0.5" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
</linearGradient>
<radialGradient id="bokeh"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.62"/><stop offset="0.65" stop-color="#FFFFFF" stop-opacity="0.12"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
<linearGradient id="leak" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0.9"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
</linearGradient>
<radialGradient id="vig" cx="0.5" cy="0.42" r="0.78"><stop offset="0.5" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.34"/></radialGradient>
</defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
${band}
${blobs}
${horizon}
${leak}
<rect width="${w}" height="${h}" fill="url(#vig)"/>
</svg>`

  return svgDataUrl(svg)
}

/** 头像占位：暖色圆盘 + 心形轮廓，避免伪造人物照片，也与页面暖色调一致 */
export function placeholderAvatar(seed: string): string {
  const warm: [string, string, string][] = [
    ['#F7D2BC', '#E39A78', '#A9603F'],
    ['#F6DCC2', '#DDAE7E', '#9A6A45'],
    ['#F3CECB', '#D98F86', '#8E4E45'],
    ['#F2D8C6', '#D6A184', '#8A5E48'],
  ]
  const [c0, c1, c2] = warm[hashSeed(seed) % warm.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${c0}"/><stop offset="0.55" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
</linearGradient>
<radialGradient id="hl" cx="0.34" cy="0.28" r="0.6">
<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.5"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="320" height="320" fill="url(#g)"/>
<rect width="320" height="320" fill="url(#hl)"/>
<path d="M160 226c-4 0-7.6-1.4-10.5-4.2l-52-50.4c-16.4-15.9-16.4-41.8 0-57.7 16-15.5 41.8-15.5 57.8 0l4.7 4.6 4.7-4.6c16-15.5 41.8-15.5 57.8 0 16.4 15.9 16.4 41.8 0 57.7l-52 50.4c-2.9 2.8-6.5 4.2-10.5 4.2Z" fill="#FFFFFF" opacity="0.9"/>
</svg>`
  return svgDataUrl(svg)
}
