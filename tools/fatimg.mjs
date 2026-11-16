// Build FAT12/FAT16 images (and read them back) without admin rights.
// Used for the virtual USB stick and for host/guest file exchange images.
//
//   buildImage(out, { sizeBytes, label, partitioned, fatType, files })
//     files: [{ dosPath: 'WFW311', hostPath: 'C:\\dir' | null, isDir: true }]
//
// DOS 6.22 cannot read FAT32, so FAT16 is the target for anything large.
import fs from 'node:fs';
import path from 'node:path';

const SECTOR = 512;
// The image is streamed to disk, but the cap still bounds an accidental huge
// request (and stays inside FAT16's practical range).
export const MAX_IMAGE_BYTES = 512 * 1024 * 1024;

const CLUSTER_SIZES = [
  { max: 16 * 1024 * 1024, spc: 4 },
  { max: 128 * 1024 * 1024, spc: 4 },
  { max: 256 * 1024 * 1024, spc: 8 },
  { max: 512 * 1024 * 1024, spc: 16 },
  { max: 1024 * 1024 * 1024, spc: 32 },
  { max: 2048 * 1024 * 1024, spc: 64 },
  { max: Infinity, spc: 64 },
];

// FAT12/FAT16 is chosen by cluster count, not by the BPB type string. A volume
// built with fewer than 4085 clusters is FAT12 to DOS and Windows even though
// the 16-bit FAT entries look valid to our own reader.
const MIN_FAT16_CLUSTERS = 4085;
const MAX_FAT16_CLUSTERS = 65524;

function pickSpc(sizeBytes) {
  for (const s of CLUSTER_SIZES) if (sizeBytes <= s.max) return s.spc;
  return 64;
}

function dosName(name) {
  const upper = name.toUpperCase();
  const dot = upper.lastIndexOf('.');
  let base = (dot > 0 ? upper.slice(0, dot) : upper).replace(/[^A-Z0-9_$~!#%&'()\-@^`{}]/g, '');
  let ext = (dot > 0 ? upper.slice(dot + 1) : '').replace(/[^A-Z0-9]/g, '');
  if (!base) base = '_';
  base = base.slice(0, 8);
  ext = ext.slice(0, 3);
  return { base: base.padEnd(8, ' '), ext: ext.padEnd(3, ' ') };
}

function fatDate(d) {
  return (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
}
function fatTime(d) {
  return ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
}

/** Walk host directories into a plain tree of {name, dir, children, size, mtime}. */
export function treeFromHost(hostPath, dosNameHint = null, seen = new Set()) {
  const st = fs.lstatSync(hostPath);
  if (st.isSymbolicLink()) {
    throw new Error(`symlinked paths are not supported: ${hostPath}`);
  }
  const name = dosNameHint ?? path.basename(hostPath);
  if (st.isDirectory()) {
    const real = fs.realpathSync(hostPath);
    if (seen.has(real)) {
      throw new Error(`directory cycle detected: ${hostPath}`);
    }
    seen.add(real);
    const children = fs.readdirSync(hostPath)
      .filter((n) => !n.startsWith('.'))
      .sort()
      .map((n) => treeFromHost(path.join(hostPath, n), n, seen));
    return { name, dir: true, children, mtime: st.mtime };
  }
  return { name, dir: false, size: st.size, hostPath, mtime: st.mtime };
}

function planGeometry(sizeBytes, spcRequested) {
  const totalSectors = Math.floor(sizeBytes / SECTOR);
  const reserved = 1;
  const fats = 2;
  const rootEntries = 512;
  const rootSectors = Math.ceil((rootEntries * 32) / SECTOR);

  const measure = (spc) => {
    let fatSectors = 1;
    let clusters = 0;
    for (let i = 0; i < 40; i++) {
      const dataSectors = totalSectors - reserved - fats * fatSectors - rootSectors;
      clusters = Math.floor(dataSectors / spc);
      const need = Math.ceil(((clusters + 2) * 2) / SECTOR);
      if (need === fatSectors) break;
      fatSectors = need;
    }
    return { spc, clusters, fatSectors };
  };

  let geometry;
  if (spcRequested != null) {
    geometry = measure(spcRequested);
  } else {
    let spc = pickSpc(sizeBytes);
    geometry = measure(spc);
    // Shrink the cluster size until the volume is legal FAT16. Sizes above
    // this loop only ever need the table value.
    while (geometry.clusters < MIN_FAT16_CLUSTERS && spc > 1) {
      spc /= 2;
      geometry = measure(spc);
    }
  }

  if (geometry.clusters < MIN_FAT16_CLUSTERS) {
    throw new Error(
      `image too small for FAT16 (${geometry.clusters} clusters, need ${MIN_FAT16_CLUSTERS}); `
      + 'FAT12 is not implemented, so use at least about 2.2 MiB',
    );
  }
  if (geometry.clusters > MAX_FAT16_CLUSTERS) {
    throw new Error(
      `too many clusters for FAT16 (${geometry.clusters}, maximum ${MAX_FAT16_CLUSTERS}); use a larger cluster size`,
    );
  }

  return {
    spc: geometry.spc,
    totalSectors,
    reserved,
    fats,
    rootEntries,
    rootSectors,
    fatSectors: geometry.fatSectors,
    clusters: geometry.clusters,
  };
}

/** Assign clusters to every file/dir below `node`. Root uses the fixed root area. */
function allocate(node, startCluster, state, allocated = []) {
  const dirCluster = startCluster;
  node.cluster = dirCluster;
  let next = dirCluster + Math.ceil((node.children.length + 3) * 32 / (state.spc * SECTOR));
  for (const child of node.children) {
    if (child.dir) {
      child.cluster = next;
      next = allocate(child, next, state, allocated);
    } else {
      const clusterCount = Math.max(1, Math.ceil(child.size / (state.spc * SECTOR)));
      child.cluster = next;
      child.clusterCount = clusterCount;
      if (Array.isArray(allocated)) allocated.push({ name: child.name, cluster: child.cluster, size: child.size });
      next += clusterCount;
    }
  }
  if (next - 2 > state.clusters) {
    throw new Error(`image too small: need ${next - 2} clusters, have ${state.clusters}`);
  }
  return next;
}

/** Assign collision-free 8.3 names to every child of one directory. */
function assignShortNames(children) {
  const used = new Set();
  for (const child of children) {
    const { base, ext } = dosName(child.name);
    const stem = base.replace(/\s+$/, '');
    const key = (candidate) => `${candidate.replace(/\s+$/, '')}.${ext.replace(/\s+$/, '')}`;
    let candidate = base;
    for (let n = 1; used.has(key(candidate)); n++) {
      if (n > 9999) throw new Error(`cannot assign a unique 8.3 name to ${child.name}`);
      const suffix = `~${n}`;
      candidate = (stem.slice(0, Math.max(1, 8 - suffix.length)) + suffix).padEnd(8, ' ');
    }
    used.add(key(candidate));
    child.dosBase = candidate;
    child.dosExt = ext;
  }
}

function writeDirEntries(buf, offset, children, label) {
  let p = offset;
  for (const child of children) {
    const fallback = dosName(child.name);
    const base = child.dosBase ?? fallback.base;
    const ext = child.dosExt ?? fallback.ext;
    buf.write(base, p, 8, 'latin1');
    buf.write(ext, p + 8, 3, 'latin1');
    buf[p + 11] = child.dir ? 0x10 : 0x20;
    const t = child.mtime ?? new Date();
    buf.writeUInt16LE(fatTime(t), p + 14);
    buf.writeUInt16LE(fatDate(t), p + 16);
    buf.writeUInt16LE(fatDate(t), p + 18);
    buf.writeUInt16LE(child.cluster & 0xffff, p + 26);
    if (!child.dir) buf.writeUInt32LE(child.size, p + 28);
    p += 32;
  }
  if (label) {
    buf.write(label.toUpperCase().slice(0, 11).padEnd(11, ' '), p, 11, 'latin1');
    buf[p + 11] = 0x08;
  } else {
    buf[p] = 0x00;
  }
}

function writeAt(fd, buf, offset) {
  let written = 0;
  while (written < buf.length) {
    written += fs.writeSync(fd, buf, written, buf.length - written, offset + written);
  }
}

function buildFat(fd, state, root) {
  const { spc, fatSectors, reserved, rootSectors } = state;
  const partOffset = state.partitionOffset ?? 0;
  const clusterBytes = spc * SECTOR;
  const dataStart = partOffset + (reserved + 2 * fatSectors + rootSectors) * SECTOR;
  const clusterOffset = (c) => dataStart + (c - 2) * clusterBytes;

  const fat = new Uint16Array(state.clusters + 2);
  fat[0] = 0xfff8;
  fat[1] = 0xffff;
  const chain = (start, count) => {
    for (let i = 0; i < count; i++) fat[start + i] = (i === count - 1) ? 0xffff : start + i + 1;
  };

  // Stream each file one cluster at a time; never hold the whole file or the
  // whole image in memory.
  const writeFile = (node) => {
    const count = Math.max(1, Math.ceil(node.size / clusterBytes));
    chain(node.cluster, count);
    if (node.size === 0) return;
    const input = fs.openSync(node.hostPath, 'r');
    try {
      const chunk = Buffer.alloc(clusterBytes, 0);
      let cluster = node.cluster;
      let remaining = node.size;
      while (remaining > 0) {
        const read = fs.readSync(input, chunk, 0, Math.min(clusterBytes, remaining), null);
        if (read <= 0) break;
        writeAt(fd, chunk.subarray(0, read), clusterOffset(cluster));
        remaining -= read;
        cluster++;
      }
    } finally {
      fs.closeSync(input);
    }
  };

  const writeDir = (node, isRoot, parentCluster) => {
    const bytes = isRoot ? rootSectors * SECTOR : Math.ceil((node.children.length + 3) * 32 / clusterBytes) * clusterBytes;
    const buf = Buffer.alloc(bytes, 0);
    let pos = 0;
    if (!isRoot) {
      buf.write('.          ', pos, 11, 'latin1');
      buf[pos + 11] = 0x10;
      buf.writeUInt16LE(node.cluster, pos + 26);
      pos += 32;
      buf.write('..         ', pos, 11, 'latin1');
      buf[pos + 11] = 0x10;
      buf.writeUInt16LE(parentCluster, pos + 26);
      pos += 32;
    }
    writeDirEntries(buf, pos, node.children, isRoot ? state.label : null);
    if (isRoot) {
      writeAt(fd, buf, partOffset + (reserved + 2 * fatSectors) * SECTOR);
    } else {
      chain(node.cluster, bytes / clusterBytes);
      writeAt(fd, buf, clusterOffset(node.cluster));
    }
    for (const child of node.children) {
      if (child.dir) writeDir(child, false, isRoot ? 0 : node.cluster);
      else writeFile(child);
    }
  };

  writeDir(root, true, 0);

  // Write both FAT copies.
  const fatBuf = Buffer.alloc(fatSectors * SECTOR, 0);
  for (let i = 0; i < fat.length; i++) fatBuf.writeUInt16LE(fat[i], i * 2);
  for (let f = 0; f < 2; f++) {
    writeAt(fd, fatBuf, partOffset + (reserved + f * fatSectors) * SECTOR);
  }
}

function bootSector(state, sizeBytes, partitionOffset) {
  const b = Buffer.alloc(SECTOR, 0);
  const { spc, reserved, fats, rootEntries, totalSectors, fatSectors } = state;
  b[0] = 0xeb; b[1] = 0x3c; b[2] = 0x90;
  b.write('MSDOS5.0', 3, 'latin1');
  b.writeUInt16LE(SECTOR, 11);
  b[13] = spc;
  b.writeUInt16LE(reserved, 14);
  b[16] = fats;
  b.writeUInt16LE(rootEntries, 17);
  const small = partitionOffset ? state.partitionSectors : totalSectors;
  b.writeUInt16LE(small < 65536 ? small : 0, 19);
  b[21] = 0xf8;
  b.writeUInt16LE(fatSectors, 22);
  b.writeUInt16LE(63, 24);
  b.writeUInt16LE(255, 26);
  b.writeUInt32LE(partitionOffset, 28);
  b.writeUInt32LE(small >= 65536 ? small : 0, 32);
  b[36] = 0x80;
  b[38] = 0x29;
  b.writeUInt32LE(0x12345678, 39);
  b.write('NO NAME    ', 43, 'latin1');
  b.write('FAT16   ', 54, 'latin1');
  b[510] = 0x55; b[511] = 0xaa;
  return b;
}

function mbr(partitionOffset, partitionSectors, state) {
  const m = Buffer.alloc(SECTOR, 0);
  const heads = 255, sectors = 63;
  const chs = (lba) => {
    const c = Math.floor(lba / (heads * sectors));
    const h = Math.floor((lba % (heads * sectors)) / sectors);
    const s = (lba % sectors) + 1;
    return [h & 0xff, ((c >> 8) & 0x03) << 6 | (s & 0x3f), c & 0xff];
  };
  const [h0, s0, c0] = chs(partitionOffset);
  const [h1, s1, c1] = chs(partitionOffset + partitionSectors - 1);
  const p = 446;
  m[p] = 0x80;
  m[p + 1] = h0; m[p + 2] = s0; m[p + 3] = c0;
  m[p + 4] = 0x06;
  m[p + 5] = h1; m[p + 6] = s1; m[p + 7] = c1;
  m.writeUInt32LE(partitionOffset, p + 8);
  m.writeUInt32LE(partitionSectors, p + 12);
  m[510] = 0x55; m[511] = 0xaa;
  return m;
}

export function buildImage(outPath, { sizeBytes, label = 'NO NAME', partitioned = false, fatType = 16, files = [], spc = undefined }) {
  if (fatType !== 16) throw new Error('FAT12 not implemented (only FAT16 is supported)');
  if (!Number.isInteger(sizeBytes) || sizeBytes < 4096) throw new Error('sizeBytes must be an integer >= 4096');
  if (sizeBytes > MAX_IMAGE_BYTES) {
    throw new Error(`image too large: ${sizeBytes} bytes; maximum is ${MAX_IMAGE_BYTES}`);
  }
  const offsetSectors = partitioned ? 2048 : 0;
  if (sizeBytes <= offsetSectors * SECTOR) throw new Error('sizeBytes is too small for a partitioned image');
  const usableBytes = sizeBytes - offsetSectors * SECTOR;

  // Build the in-memory tree from the files spec.
  const root = { name: '', dir: true, children: [] };
  for (const f of files) {
    const node = treeFromHost(f.hostPath, f.dosPath || undefined, new Set());
    if (!f.dosPath && node.dir) {
      // Empty dosPath means "splice this folder's contents into the image root".
      root.children.push(...node.children);
      continue;
    }
    if (f.dosPath) node.name = f.dosPath;
    root.children.push(node);
  }

  const state = planGeometry(usableBytes, spc);
  state.label = label;
  state.partitionSectors = Math.floor(usableBytes / SECTOR);
  state.partitionOffset = offsetSectors * SECTOR;
  if (root.children.length >= state.rootEntries) {
    throw new Error(
      `too many entries in the image root (${root.children.length}); the FAT16 root holds ${state.rootEntries - 1} `
      + 'files and directories. Put the files in a subdirectory instead.',
    );
  }
  const assignNames = (node) => {
    assignShortNames(node.children);
    for (const child of node.children) if (child.dir) assignNames(child);
  };
  assignNames(root);
  const allocated = [];
  allocate(root, 2, state, allocated);

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  const tmpPath = `${outPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let fd = null;
  try {
    fd = fs.openSync(tmpPath, 'w');
    fs.ftruncateSync(fd, sizeBytes);
    buildFat(fd, state, root);
    writeAt(fd, bootSector(state, usableBytes, offsetSectors), offsetSectors * SECTOR);
    if (partitioned) writeAt(fd, mbr(offsetSectors, state.partitionSectors, state), 0);
    fs.closeSync(fd);
    fd = null;
    // Publish atomically so a failed build never leaves a half-written image.
    fs.renameSync(tmpPath, outPath);
  } catch (err) {
    if (fd != null) { try { fs.closeSync(fd); } catch {} }
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
  return { path: outPath, bytes: sizeBytes, clusters: state.clusters, spc: state.spc, allocated: allocated.length };
}

const PARTITION_TYPES = new Set([0x01, 0x04, 0x05, 0x06, 0x0b, 0x0c, 0x0e, 0x0f]);

/** Does this 512-byte block look like a FAT12/FAT16 boot sector? */
function looksLikeBpb(buf) {
  if (!buf || buf.length < SECTOR) return false;
  if (buf[0] !== 0xeb && buf[0] !== 0xe9) return false;
  if (buf.readUInt16LE(11) !== SECTOR) return false;
  const spc = buf[13];
  if (spc === 0 || spc > 128 || (spc & (spc - 1)) !== 0) return false;
  if (buf.readUInt16LE(14) === 0) return false;
  if (buf[16] < 1 || buf[16] > 2) return false;
  if (buf.readUInt16LE(17) === 0) return false;
  return true;
}

/** Return the first partition's offset when the image starts with a real MBR. */
function mbrPartition(img) {
  if (img.length < SECTOR || img[510] !== 0x55 || img[511] !== 0xaa) return null;
  const p = 446;
  if (img[p] !== 0x00 && img[p] !== 0x80) return null;
  if (!PARTITION_TYPES.has(img[p + 4])) return null;
  const start = img.readUInt32LE(p + 8);
  const sectors = img.readUInt32LE(p + 12);
  if (!start || !sectors) return null;
  const base = start * SECTOR;
  if (base + SECTOR > img.length) return null;
  if (!looksLikeBpb(img.subarray(base, base + SECTOR))) return null;
  return { base, sectors };
}

/** Parse the volume geometry and FAT of an image, following a partition table if present. */
function openVolume(imgPath) {
  const img = fs.readFileSync(imgPath);
  // A non-partitioned boot sector also carries 0x55AA at 510 and boot code can
  // put any dword at 454, so validate the partition entry and the BPB instead
  // of trusting one offset.
  const partition = mbrPartition(img);
  const base = partition ? partition.base : 0;
  const bpb = img.subarray(base);
  const spc = bpb[13];
  const reserved = bpb.readUInt16LE(14);
  const fats = bpb[16];
  const rootEntries = bpb.readUInt16LE(17);
  const fatSectors = bpb.readUInt16LE(22);
  const totalSectors = bpb.readUInt32LE(32) || bpb.readUInt16LE(19);
  const rootStart = base + (reserved + fats * fatSectors) * SECTOR;
  const dataStart = rootStart + rootEntries * 32;
  const clusterBytes = spc * SECTOR;
  const fatStart = base + reserved * SECTOR;
  const dataSectors = totalSectors - (reserved + fats * fatSectors) - Math.ceil(rootEntries / 16);
  const clusters = Math.max(0, Math.floor(dataSectors / spc));
  // Trust the BPB label first: buildImage always writes 16-bit FAT entries, even for small
  // volumes where the cluster count alone would suggest FAT12.
  const fsType = bpb.toString('latin1', 54, 62).trim().toUpperCase();
  const fat12 = fsType === 'FAT12' ? true : fsType === 'FAT16' ? false : clusters < 4085;

  const nextCluster = (c) => {
    if (fat12) {
      const off = fatStart + Math.floor((c * 3) / 2);
      if (off + 2 > img.length) return 0xffff;
      const word = img.readUInt16LE(off);
      return (c & 1) ? (word >> 4) & 0x0fff : word & 0x0fff;
    }
    const off = fatStart + c * 2;
    if (off + 2 > img.length) return 0xffff;
    return img.readUInt16LE(off) & 0xffff;
  };

  const chain = (start) => {
    const chunks = [];
    const seen = new Set();
    let c = start;
    while (c >= 2 && c < 0xfff8 && !seen.has(c)) {
      seen.add(c);
      chunks.push(img.subarray(dataStart + (c - 2) * clusterBytes, dataStart + (c - 1) * clusterBytes));
      c = nextCluster(c);
    }
    return Buffer.concat(chunks);
  };

  return {
    img, spc, rootEntries, rootStart, dataStart, clusterBytes, clusterCount: clusters, fat12,
    nextCluster,
    rootDir: () => img.subarray(rootStart, rootStart + rootEntries * 32),
    dirAt: (c) => chain(c),
  };
}

/** Decode one 32-byte directory entry into { name, dir, cluster, size }, or null to skip it. */
function decodeEntry(e) {
  if (e[0] === 0x00) return { end: true };
  if (e[0] === 0xe5) return null;
  if (e[11] & 0x08) return null; // volume label
  if ((e[11] & 0x0f) === 0x0f) return null; // long file name entries
  const base = e.toString('latin1', 0, 8).trimEnd();
  const ext = e.toString('latin1', 8, 11).trim();
  const name = base + (ext ? '.' + ext : '');
  if (name === '.' || name === '..') return null;
  return {
    name,
    dir: Boolean(e[11] & 0x10),
    cluster: e.readUInt16LE(26),
    size: e.readUInt32LE(28),
  };
}

/** Find an entry by 8.3 name, case-insensitively, in a raw directory buffer. */
function findEntry(dirBuf, name) {
  const want = name.toUpperCase();
  for (let i = 0; i + 32 <= dirBuf.length; i += 32) {
    const entry = decodeEntry(dirBuf.subarray(i, i + 32));
    if (!entry) continue;
    if (entry.end) return null;
    if (entry.name.toUpperCase() === want) return entry;
  }
  return null;
}

/** Read a FAT12/FAT16 image and return its directory listing. */
export function listImage(imgPath) {
  const vol = openVolume(imgPath);
  const out = [];
  const visited = new Set();
  const walk = (dirBuf, prefix, cluster) => {
    if (cluster != null && visited.has(cluster)) return;
    if (cluster != null) visited.add(cluster);
    for (let i = 0; i < dirBuf.length; i += 32) {
      const entry = decodeEntry(dirBuf.subarray(i, i + 32));
      if (!entry) continue;
      if (entry.end) return;
      out.push({ path: prefix + entry.name, dir: entry.dir, size: entry.size });
      if (entry.dir) {
        const c = entry.cluster;
        if (c == null || visited.has(c)) continue;
        walk(vol.dirAt(c), prefix + entry.name + '/', c);
      }
    }
  };
  walk(vol.rootDir(), '', null);
  return out;
}

/**
 * Read one file out of a FAT12/FAT16 image.
 * Accepts `DIR/FILE.EXT` or `DIR\FILE.EXT`, matched case-insensitively.
 */
export function readImage(imgPath, dosPath) {
  const parts = String(dosPath ?? '').split(/[\\/]+/).filter((p) => p && p !== '.');
  if (!parts.length) throw new Error('readImage: empty path');
  const vol = openVolume(imgPath);

  let dirBuf = vol.rootDir();
  let entry = null;
  const visitedDirs = new Set();
  for (let i = 0; i < parts.length; i++) {
    entry = findEntry(dirBuf, parts[i]);
    if (!entry) throw new Error(`readImage: no such file in image: ${dosPath}`);
    if (i === parts.length - 1) break;
    if (!entry.dir) throw new Error(`readImage: not a directory: ${parts.slice(0, i + 1).join('/')}`);
    if (visitedDirs.has(entry.cluster)) throw new Error(`readImage: directory cycle detected: ${dosPath}`);
    visitedDirs.add(entry.cluster);
    dirBuf = vol.dirAt(entry.cluster);
  }
  if (entry.dir) throw new Error(`readImage: is a directory: ${dosPath}`);
  if (entry.size === 0) return Buffer.alloc(0);

  const data = [];
  let remaining = entry.size;
  let c = entry.cluster;
  const seen = new Set();
  while (remaining > 0 && c >= 2 && c < 0xfff8 && !seen.has(c)) {
    seen.add(c);
    const chunk = vol.img.subarray(vol.dataStart + (c - 2) * vol.clusterBytes, vol.dataStart + (c - 1) * vol.clusterBytes);
    data.push(chunk);
    remaining -= chunk.length;
    c = vol.nextCluster(c);
  }
  const buf = Buffer.concat(data);
  if (buf.length < entry.size) throw new Error(`readImage: truncated file: ${dosPath}`);
  return Buffer.from(buf.subarray(0, entry.size));
}

if (process.argv[1] && process.argv[1].endsWith('fatimg.mjs')) {
  const [cmd, file] = process.argv.slice(2);
  if (cmd === 'list') {
    for (const e of listImage(file)) console.log(`${e.dir ? 'DIR ' : 'FILE'} ${String(e.size).padStart(9)} ${e.path}`);
  } else {
    console.error('usage: fatimg.mjs list <image>');
    process.exit(2);
  }
}
