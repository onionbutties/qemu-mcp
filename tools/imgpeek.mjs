// Decode a QEMU screenshot (PPM P6 or PNG) and render it as ASCII.
// QEMU's screendump writes PPM in this build, so PPM is the common case.
import fs from 'node:fs';
import zlib from 'node:zlib';

const RAMP = ' .:-=+*#%@';

function decodePpm(buf) {
  if (buf.toString('latin1', 0, 2) !== 'P6') throw new Error('not a P6 PPM');
  let pos = 2;
  const tokens = [];
  while (tokens.length < 3) {
    while (pos < buf.length && /\s/.test(String.fromCharCode(buf[pos]))) pos++;
    if (buf[pos] === 0x23) { while (buf[pos] !== 0x0a) pos++; continue; }
    let t = '';
    while (pos < buf.length && !/\s/.test(String.fromCharCode(buf[pos]))) t += String.fromCharCode(buf[pos++]);
    tokens.push(t);
  }
  pos++;
  const [w, h, max] = tokens.map(Number);
  if (max !== 255) throw new Error('unsupported PPM maxval ' + max);
  const need = w * h * 3;
  const data = buf.subarray(pos, pos + need);
  if (data.length < need) throw new Error('truncated PPM');
  return { width: w, height: h, channels: 3, data };
}

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (bitDepth !== 8) throw new Error('unsupported bit depth ' + bitDepth);
  if (interlace !== 0) throw new Error('interlaced PNG unsupported');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error('unsupported colour type ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          break;
        }
        default: throw new Error('bad filter ' + filter);
      }
      cur[x] = v & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels, data: out };
}

export function decodeImage(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0x50 && buf[1] === 0x36) return decodePpm(buf);
  if (buf[0] === 0x89 && buf[1] === 0x50) return decodePng(buf);
  throw new Error('unrecognised image format');
}

function pixel(img, x, y) {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

export function toAscii(img, { cols = 100, rows = 0, crop = null } = {}) {
  const c = crop ?? { x: 0, y: 0, w: img.width, h: img.height };
  const outRows = rows || Math.max(1, Math.round(((c.h / c.w) * cols) / 2));
  const lines = [];
  for (let ry = 0; ry < outRows; ry++) {
    let line = '';
    for (let rx = 0; rx < cols; rx++) {
      const x0 = c.x + Math.floor((rx * c.w) / cols);
      const x1 = c.x + Math.max(x0 + 1, Math.floor(((rx + 1) * c.w) / cols));
      const y0 = c.y + Math.floor((ry * c.h) / outRows);
      const y1 = c.y + Math.max(y0 + 1, Math.floor(((ry + 1) * c.h) / outRows));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y += Math.max(1, Math.floor((y1 - y0) / 3))) {
        for (let x = x0; x < x1; x += Math.max(1, Math.floor((x1 - x0) / 3))) {
          const [r, g, b] = pixel(img, Math.min(x, img.width - 1), Math.min(y, img.height - 1));
          sum += 0.299 * r + 0.587 * g + 0.114 * b;
          n++;
        }
      }
      const lum = n ? sum / n : 0;
      line += RAMP[Math.min(RAMP.length - 1, Math.floor((lum / 256) * RAMP.length))];
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}

export function colours(img, step = 4) {
  const counts = new Map();
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const [r, g, b] = pixel(img, x, y);
      const k = `${r >> 4},${g >> 4},${b >> 4}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([k, v]) => `${k}:${v}`);
}

if (process.argv[1] && process.argv[1].endsWith('imgpeek.mjs')) {
  const file = process.argv[2];
  if (!file) { console.error('usage: imgpeek <file> [cols]'); process.exit(1); }
  const img = decodeImage(file);
  console.log(`size=${img.width}x${img.height} channels=${img.channels}`);
  console.log('top colours:', colours(img).join(' '));
  console.log(toAscii(img, { cols: Number(process.argv[3]) || 100 }));
}
