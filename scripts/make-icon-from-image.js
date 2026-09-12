/**
 * 把 build/icon.ico 里用户放入的图片（任意常见格式）转成真正的多尺寸 Windows ICO。
 * 同时覆盖掉图片右下角的「豆包AI生成」水印（用背景色填充）。
 * 运行：node scripts/make-icon-from-image.js
 */
const fs = require('node:fs')
const path = require('node:path')
const Jimp = require('jimp')
const _pngToIco = require('png-to-ico')
const pngToIco = _pngToIco.default ?? _pngToIco

async function main() {
  const buildDir = path.join(__dirname, '..', 'build')
  const src = path.join(buildDir, 'icon.ico')
  const tmpPng = path.join(buildDir, 'icon-src.png')

  // jimp 按内容识别格式，但换上 .png 后缀更稳
  fs.copyFileSync(src, tmpPng)
  const img = await Jimp.read(tmpPng)
  const { width: w, height: h } = img.bitmap
  console.log(`source: ${w}x${h}`)

  // 取水印左侧同一水平线上的背景色，覆盖右下角水印区域
  const sample = img.getPixelColor(Math.floor(w * 0.5), Math.floor(h * 0.94))
  const x0 = Math.floor(w * 0.7)
  const y0 = Math.floor(h * 0.9)
  for (let y = y0; y < h; y++) {
    for (let x = x0; x < w; x++) {
      img.setPixelColor(sample, x, y)
    }
  }
  console.log('watermark covered')

  // 生成多尺寸 PNG 并打包为 ICO
  const sizes = [256, 128, 64, 48, 32, 16]
  const files = []
  for (const size of sizes) {
    const file = path.join(buildDir, `icon-${size}.png`)
    const copy = img.clone().resize(size, size, Jimp.RESIZE_BICUBIC)
    await copy.writeAsync(file)
    files.push(file)
  }
  const ico = await pngToIco(files)
  fs.writeFileSync(src, ico)
  fs.copyFileSync(files[0], path.join(buildDir, 'icon.png'))
  for (const file of files) fs.rmSync(file, { force: true })
  fs.rmSync(tmpPng, { force: true })
  console.log(`icon.ico written: ${ico.length} bytes (${sizes.join('/')})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
