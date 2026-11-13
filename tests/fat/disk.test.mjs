import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildImage, listImage, readImage } from '../../tools/fatimg.mjs';

const work = path.join(process.cwd(), 'tests', 'tmp', 'fat-disk');
fs.mkdirSync(work, { recursive: true });
const tmp = path.join(work, 'mcp-fat.img');

test('readImage round-trips a built FAT image', () => {
  fs.rmSync(tmp, { force: true });
  const src = path.join(work, 'HELLO.TXT');
  fs.writeFileSync(src, 'hello from fat\n');
  buildImage(tmp, { sizeBytes: 4 * 1024 * 1024, files: [{ dosPath: 'HELLO.TXT', hostPath: src }] });
  const buf = readImage(tmp, 'HELLO.TXT');
  assert.equal(buf.toString('utf8'), 'hello from fat\n');
  const entries = listImage(tmp);
  assert.ok(entries.some((e) => e.path === 'HELLO.TXT' && !e.dir));
});

test('readImage follows multi-cluster chains', () => {
  fs.rmSync(tmp, { force: true });
  const src = path.join(work, 'BIG.BIN');
  const payload = Buffer.alloc(20000);
  for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
  fs.writeFileSync(src, payload);
  buildImage(tmp, { sizeBytes: 4 * 1024 * 1024, files: [{ dosPath: 'BIG.BIN', hostPath: src }] });
  assert.equal(readImage(tmp, 'big.bin').length, payload.length);
  assert.ok(readImage(tmp, 'BIG.BIN').equals(payload));
});

test('readImage decodes a 12-bit FAT', () => {
  // Hand-built 1.44 MB FAT12 floppy: one 1300-byte file across clusters 2-4.
  const floppy = path.join(work, 'mcp-fat12.img');
  const img = Buffer.alloc(2880 * 512, 0);
  img[0] = 0xeb; img[1] = 0x3c; img[2] = 0x90;
  img.write('MSDOS5.0', 3, 'latin1');
  img.writeUInt16LE(512, 11);
  img[13] = 1;
  img.writeUInt16LE(1, 14);
  img[16] = 1;
  img.writeUInt16LE(224, 17);
  img.writeUInt16LE(2880, 19);
  img[21] = 0xf0;
  img.writeUInt16LE(9, 22);
  img.write('FAT12   ', 54, 'latin1');
  img[510] = 0x55; img[511] = 0xaa;

  const fatStart = 512;
  const setFat12 = (i, v) => {
    const off = fatStart + Math.floor((i * 3) / 2);
    if (i & 1) {
      img[off] = (img[off] & 0x0f) | ((v << 4) & 0xf0);
      img[off + 1] = (v >> 4) & 0xff;
    } else {
      img[off] = v & 0xff;
      img[off + 1] = (img[off + 1] & 0xf0) | ((v >> 8) & 0x0f);
    }
  };
  setFat12(0, 0xff8);
  setFat12(1, 0xfff);
  setFat12(2, 3);
  setFat12(3, 4);
  setFat12(4, 0xfff);

  const rootStart = fatStart + 9 * 512;
  img.write('F12     TXT', rootStart, 11, 'latin1');
  img[rootStart + 11] = 0x20;
  img.writeUInt16LE(2, rootStart + 26);
  img.writeUInt32LE(1300, rootStart + 28);

  const dataStart = rootStart + 224 * 32;
  const payload = Buffer.alloc(1300);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) % 256;
  payload.copy(img, dataStart);
  fs.writeFileSync(floppy, img);

  assert.ok(listImage(floppy).some((e) => e.path === 'F12.TXT' && e.size === 1300));
  assert.ok(readImage(floppy, 'f12.txt').equals(payload));
});

test('readImage walks directories case-insensitively and reports missing files', () => {
  fs.rmSync(tmp, { force: true });
  const dir = path.join(work, 'fat-src');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'SUB'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'HELLO.TXT'), 'hello from fat\n');
  fs.writeFileSync(path.join(dir, 'SUB', 'DEEP.TXT'), 'deep file\n');
  buildImage(tmp, { sizeBytes: 4 * 1024 * 1024, files: [{ dosPath: null, hostPath: dir }] });

  assert.equal(readImage(tmp, 'sub/deep.txt').toString('utf8'), 'deep file\n');
  assert.equal(readImage(tmp, '\\SUB\\DEEP.TXT').toString('utf8'), 'deep file\n');
  assert.throws(() => readImage(tmp, 'NOPE.TXT'), /no such file/i);
});
