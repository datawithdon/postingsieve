// Draws the extension icons (a sieve: a ring with a grid of holes) with no image tools.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) pixel(x, y).forEach((v, i) => { raw[row + 1 + x * 4 + i] = v; });
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = ~0; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

for (const size of [16, 48, 128]) {
  const c = size / 2, R = size / 2 - 0.5, grid = size >= 48 ? size / 6 : size / 3.2, hole = grid * 0.28;
  writeFileSync(`public/icon-${size}.png`, png(size, (x, y) => {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy);
    if (d > R) return [0, 0, 0, 0];
    const gx = ((dx % grid) + grid) % grid - grid / 2, gy = ((dy % grid) + grid) % grid - grid / 2;
    const inner = d < R * 0.78;
    return inner && Math.hypot(gx, gy) < hole ? [255, 255, 255, 255] : [11, 122, 62, 255];
  }));
}
