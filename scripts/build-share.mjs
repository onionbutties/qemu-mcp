// Build the guest's file-exchange disk from the host `share/` folder.
// Rebuilt on every launch, so guest-side writes to it are temporary.
import fs from 'node:fs';
import { buildImage, listImage } from '../tools/fatimg.mjs';
import { P } from './lib/qemu.mjs';

const out = P('vm', 'share.img');
const src = P('share');
const sizeMb = Number(process.argv[2] ?? 64);

const result = buildImage(out, {
  sizeBytes: sizeMb * 1024 * 1024,
  label: 'SHARE',
  partitioned: true,
  files: [{ dosPath: '', hostPath: src }],
});
console.log(`share.img: ${result.bytes / 1024 / 1024} MB, ${result.clusters} clusters, ${result.allocated} files`);
if (process.argv.includes('--list')) {
  for (const e of listImage(out)) console.log(`${e.dir ? 'DIR ' : 'FILE'} ${String(e.size).padStart(9)} ${e.path}`);
}
