// Generates simple PNG icons (no image dependencies): rounded gradient square with a play triangle.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = size * 0.22;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      // rounded-rect coverage
      const dx = Math.max(r - x - 0.5, x + 0.5 - (size - r), 0);
      const dy = Math.max(r - y - 0.5, y + 0.5 - (size - r), 0);
      const inside = Math.hypot(dx, dy) <= r;
      if (!inside) continue;
      const t = (x + y) / (2 * size);
      let [R, G, B] = [124 - 40 * t, 140 - 70 * t, 255 - 40 * t];
      // play triangle
      const u = x / size, v = y / size;
      if (u > 0.38 && u < 0.72 && Math.abs(v - 0.5) < ((0.72 - u) / 0.34) * 0.22) {
        R = G = B = 255;
      }
      raw[i] = R; raw[i + 1] = G; raw[i + 2] = B; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = resolve(import.meta.dirname, '../public/icons');
mkdirSync(dir, { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(resolve(dir, `icon-${s}.png`), png(s));
console.log('icons written to', dir);
