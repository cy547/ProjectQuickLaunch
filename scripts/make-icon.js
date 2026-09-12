/**
 * 生成应用图标 build/icon.ico（256x256 BMP-in-ICO）：
 * 蓝色圆角方块 + 白色播放三角。
 * 运行：node scripts/make-icon.js
 */
const fs = require('node:fs')
const path = require('node:path')

const SIZE = 256
const RADIUS = 56

function insideRoundedRect(x, y) {
  const r = RADIUS
  const cx = Math.min(Math.max(x, r), SIZE - r)
  const cy = Math.min(Math.max(y, r), SIZE - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function insideTriangle(x, y) {
  // 顶点：左上(92,72) 左下(92,184) 右中(178,128)
  const [ax, ay] = [92, 72]
  const [bx, by] = [92, 184]
  const [cx, cy] = [178, 128]
  const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax)
  const cross2 = (x - bx) * (cy - by) - (y - by) * (cx - bx)
  const cross3 = (x - cx) * (ay - cy) - (y - cy) * (ax - cx)
  return cross <= 0 && cross2 <= 0 && cross3 <= 0
}

// BGRA 像素数据，BMP 自下而上存储
const xor = Buffer.alloc(SIZE * SIZE * 4)
for (let row = 0; row < SIZE; row++) {
  const y = SIZE - 1 - row
  for (let col = 0; col < SIZE; col++) {
    const offset = (row * SIZE + col) * 4
    if (insideTriangle(col, y)) {
      xor[offset] = 0xff // B
      xor[offset + 1] = 0xff // G
      xor[offset + 2] = 0xff // R
      xor[offset + 3] = 0xff // A
    } else if (insideRoundedRect(col, y)) {
      xor[offset] = 0xff // B (1677ff: R=22 G=119 B=255)
      xor[offset + 1] = 0x77
      xor[offset + 2] = 0x16
      xor[offset + 3] = 0xff
    } else {
      xor[offset + 3] = 0x00
    }
  }
}

// AND 掩码（1bpp，透明位），256 位/行 = 32 字节/行，全部为 0（透明由 alpha 决定）
const andMask = Buffer.alloc(SIZE * 32)

const bmpHeader = Buffer.alloc(40)
bmpHeader.writeUInt32LE(40, 0) // header size
bmpHeader.writeInt32LE(SIZE, 4) // width
bmpHeader.writeInt32LE(SIZE * 2, 8) // height (XOR + AND)
bmpHeader.writeUInt16LE(1, 12) // planes
bmpHeader.writeUInt16LE(32, 14) // bpp
bmpHeader.writeUInt32LE(0, 16) // compression BI_RGB
bmpHeader.writeUInt32LE(xor.length + andMask.length, 20)

const image = Buffer.concat([bmpHeader, xor, andMask])

const ico = Buffer.alloc(22)
ico.writeUInt16LE(0, 0) // reserved
ico.writeUInt16LE(1, 2) // type icon
ico.writeUInt16LE(1, 4) // count
ico.writeUInt8(0, 6) // width 256 -> 0
ico.writeUInt8(0, 7) // height 256 -> 0
ico.writeUInt8(0, 8) // palette
ico.writeUInt8(0, 9) // reserved
ico.writeUInt16LE(1, 10) // planes
ico.writeUInt16LE(32, 12) // bpp
ico.writeUInt32LE(image.length, 14) // bytes in res
ico.writeUInt32LE(22, 18) // offset

const outPath = path.join(__dirname, '..', 'build', 'icon.ico')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, Buffer.concat([ico, image]))
console.log(`icon written: ${outPath} (${image.length + 22} bytes)`)
