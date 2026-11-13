import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { listFatImage, readFatFile, buildFatImage } from '../../scripts/mcp/disk.mjs';

const work = path.join(process.cwd(), 'tests', 'tmp');
fs.mkdirSync(work, { recursive: true });
const img = path.join(work, 'mcp-disk.img');

test('disk helpers round-trip a FAT image', () => {
  fs.rmSync(img, { force: true });
  const src = path.join(work, 'HELLO.TXT');
  fs.writeFileSync(src, 'disk helper\n');
  buildFatImage(img, { sizeBytes: 4 * 1024 * 1024, files: [{ dosPath: 'HELLO.TXT', hostPath: src }] });
  assert.ok(listFatImage(img).some((e) => e.path === 'HELLO.TXT'));
  assert.equal(readFatFile(img, 'hello.txt').toString('utf8'), 'disk helper\n');
});
