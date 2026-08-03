/**
 * Generates the PWA icons.
 *
 * The container has no rasteriser (no ImageMagick, rsvg, sharp or PIL), so the
 * PNGs are drawn pixel by pixel and encoded here using only `node:zlib`. The
 * design is a waxing crescent in ochre on the app's near-black, echoing the
 * moon-phase icons already used throughout the time navigator.
 *
 * Run via `npm run build:icons`. Output is checked in — this does not run on
 * every build.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const BACKGROUND: [number, number, number] = [0x1a, 0x1a, 0x1a];
const OCHRE: [number, number, number] = [0xc7, 0xa7, 0x8a];

// --- Minimal PNG encoder ---------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** `pixels` is RGBA, 4 bytes per pixel, row-major. */
function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Each scanline is prefixed with filter type 0 (none).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- The icon --------------------------------------------------------------

/** Coverage of a disc at a point, sampled 3x3 for cheap antialiasing. */
function discCoverage(x: number, y: number, cx: number, cy: number, r: number): number {
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const px = x + (sx + 0.5) / 3;
      const py = y + (sy + 0.5) / 3;
      if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) hits++;
    }
  }
  return hits / 9;
}

function drawIcon(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);

  const cx = size * 0.46;
  const cy = size * 0.5;
  const r = size * 0.34;
  // Offset disc that bites the crescent out of the full moon.
  const bx = size * 0.66;
  const by = size * 0.44;
  const br = size * 0.32;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const moon = discCoverage(x, y, cx, cy, r);
      const bite = discCoverage(x, y, bx, by, br);
      const alpha = Math.max(0, moon - bite);

      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        pixels[i + c] = Math.round(BACKGROUND[c]! * (1 - alpha) + OCHRE[c]! * alpha);
      }
      pixels[i + 3] = 255;
    }
  }

  return pixels;
}

mkdirSync(OUT, { recursive: true });
for (const size of [192, 512]) {
  const file = join(OUT, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, size, drawIcon(size)));
  console.log(`  icon-${size}.png`);
}

// Maskable icons need their content inside the safe zone, so draw smaller.
const maskable = 512;
const pixels = new Uint8Array(maskable * maskable * 4);
const inner = drawIcon(Math.round(maskable * 0.6));
const innerSize = Math.round(maskable * 0.6);
const offset = Math.round((maskable - innerSize) / 2);
for (let i = 0; i < maskable * maskable; i++) {
  const p = i * 4;
  for (let c = 0; c < 3; c++) pixels[p + c] = BACKGROUND[c]!;
  pixels[p + 3] = 255;
}
for (let y = 0; y < innerSize; y++) {
  for (let x = 0; x < innerSize; x++) {
    const from = (y * innerSize + x) * 4;
    const to = ((y + offset) * maskable + (x + offset)) * 4;
    for (let c = 0; c < 4; c++) pixels[to + c] = inner[from + c]!;
  }
}
writeFileSync(join(OUT, 'icon-maskable-512.png'), encodePng(maskable, maskable, pixels));
console.log('  icon-maskable-512.png');
