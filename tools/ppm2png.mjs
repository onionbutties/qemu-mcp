// Convert a QEMU PPM screenshot to PNG so Windows OCR can read it.
//   node tools/ppm2png.mjs <in.ppm> <out.png>
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodeImage } from './imgpeek.mjs';

// zlib.crc32 only exists from Node 20.15, while package.json allows any 20.x.
let crcTable = null;
function crc32Fallback(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const pngCrc = typeof zlib.crc32 === 'function'
  ? (buf) => zlib.crc32(buf) >>> 0
  : crc32Fallback;

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc(body));
  return Buffer.concat([len, body, crc]);
}

export function writePng(file, img) {
  const { width, height, channels, data } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolour RGB
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * channels;
      const dst = y * (stride + 1) + 1 + x * 3;
      raw[dst] = data[src];
      raw[dst + 1] = data[src + 1];
      raw[dst + 2] = data[src + 2];
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  return file;
}

if (process.argv[1] && process.argv[1].endsWith('ppm2png.mjs')) {
  const [, , input, output] = process.argv;
  if (!input || !output) { console.error('usage: ppm2png <in> <out.png>'); process.exit(1); }
  writePng(output, decodeImage(input));
  console.log(output);
}
