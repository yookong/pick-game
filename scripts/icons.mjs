import { writeFileSync } from 'node:fs'
import { deflateSync, crc32 } from 'node:zlib'

function chunk(type, data) {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(data.length)
  header.write(type, 4)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])))
  return Buffer.concat([header, data, checksum])
}
const ellipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
function pixel(x, y) {
  if (ellipse(x, y, 43, 58, 2.8, 3.2) || ellipse(x, y, 57, 58, 2.8, 3.2) || ellipse(x, y, 50, 64, 2.4, 1.5)) return [84, 53, 63]
  if (ellipse(x, y, 37, 64, 3.4, 2) || ellipse(x, y, 63, 64, 3.4, 2)) return [235, 151, 150]
  if (ellipse(x, y, 50, 59, 25, 20) || ellipse(x, y, 41, 35, 7, 15) || ellipse(x, y, 59, 35, 7, 15)) return [255, 229, 192]
  return [145, 56, 66]
}
for (const size of [192, 512]) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 2
  const scanline = 1 + size * 3
  const raster = Buffer.alloc(scanline * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = y * scanline + 1 + x * 3
      raster.set(pixel(x * 100 / size, y * 100 / size), offset)
    }
  }
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(raster)), chunk('IEND', Buffer.alloc(0)),
  ]))
}
