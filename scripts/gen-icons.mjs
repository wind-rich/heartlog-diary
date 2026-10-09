// 生成 PWA 图标（纯 Node，无第三方依赖）
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(__dirname, '../public/icons')
mkdirSync(outDir, { recursive: true })

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function png(width, height, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// 画一个奶油底 + 暖红心形 + 圆角（maskable 安全区）
function render(size, maskable) {
  const px = Buffer.alloc(size * size * 4)
  const bg = [255, 246, 238]
  const heart = [217, 112, 95]
  const inset = maskable ? 0 : size * 0.0
  const radius = size * 0.22
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // 圆角矩形遮罩
      const cx = Math.min(Math.max(x, radius), size - radius)
      const cy = Math.min(Math.max(y, radius), size - radius)
      const d = Math.hypot(x - cx, y - cy)
      const inside = d <= radius + 0.5
      let [r, g, b] = bg
      const a = inside ? 255 : 0
      // 心形：归一化到画布 34%~66% 区域
      const scale = maskable ? 0.30 : 0.36
      const hx = (x - size / 2) / (size * scale)
      const hy = -(y - size * (maskable ? 0.50 : 0.48)) / (size * scale)
      const t = hx * hx + hy * hy - 1
      if (t * t * t - hx * hx * hy * hy * hy <= 0) {
        r = heart[0]
        g = heart[1]
        b = heart[2]
      }
      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
      px[i + 3] = a
    }
  }
  return png(size, size, px)
}

writeFileSync(resolve(outDir, 'icon-192.png'), render(192, false))
writeFileSync(resolve(outDir, 'icon-512.png'), render(512, false))
writeFileSync(resolve(outDir, 'icon-maskable-512.png'), render(512, true))
writeFileSync(resolve(outDir, 'icon-180.png'), render(180, false))
console.log('icons generated')
