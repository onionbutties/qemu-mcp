// Screen capture helpers for the QEMU MCP server.
// Wraps screendump, PNG conversion, OCR, ASCII rendering, and wait_for_text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { decodeImage, toAscii, cropImage } from '../../tools/imgpeek.mjs';
import { runOcr } from '../../tools/ocr.mjs';
import { writePng } from '../../tools/ppm2png.mjs';
import { readVgaText } from './vga.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueName(ext = '.ppm') {
  const rand = Math.random().toString(36).slice(2, 10);
  return `screen-${Date.now()}-${rand}${ext}`;
}

async function withOptionalLock(session, fn) {
  if (typeof session?.withLock === 'function') return session.withLock(fn);
  return fn();
}

function defaultShotsDir() {
  return process.env.QEMU_MCP_SHOTS
    ? path.resolve(process.env.QEMU_MCP_SHOTS)
    : path.join(process.cwd(), 'vm', 'shots', 'mcp');
}

export async function captureScreen(session, { outDir } = {}) {
  const dir = outDir ? path.resolve(outDir) : defaultShotsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, uniqueName('.ppm'));

  // Prefer screendump implementations that poll for the output file (monitor.screendump,
  // up to ~4s) over the short command fallbacks that return immediately.
  if (typeof session?.monitor === 'function') {
    await withOptionalLock(session, async () => {
      const mon = await session.monitor();
      if (typeof mon?.screendump === 'function') await mon.screendump(file);
      else if (typeof mon?.cmd === 'function') await mon.cmd('screendump ' + file);
      else if (typeof mon?.command === 'function') await mon.command('screendump ' + file);
      else throw new Error('session does not support screendump');
    });
  } else if (session?.mon && typeof session.mon.screendump === 'function') {
    await withOptionalLock(session, () => session.mon.screendump(file));
  } else if (typeof session?.screendump === 'function') {
    await session.screendump(file);
  } else if (typeof session?.command === 'function') {
    await session.command('screendump ' + file);
  } else if (typeof session?.cmd === 'function') {
    await session.cmd('screendump ' + file);
  } else if (session?.mon && typeof session.mon.cmd === 'function') {
    await session.mon.cmd('screendump ' + file);
  } else if (session?.mon && typeof session.mon.command === 'function') {
    await session.mon.command('screendump ' + file);
  } else if (typeof session?.qmp === 'function') {
    await session.qmp('screendump', { filename: file });
  } else {
    throw new Error('session does not support screendump');
  }

  // QEMU may write the file slightly after the monitor command returns.
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
    } catch {}
    await sleep(50);
  }
  throw new Error('screendump produced no file: ' + file);
}

export function convertToPng(ppmPath, pngPath) {
  const finalOut = pngPath
    ? path.resolve(pngPath)
    : (/\./.test(ppmPath) ? ppmPath.replace(/\.[^.]+$/, '.png') : ppmPath + '.png');
  writePng(finalOut, decodeImage(ppmPath));
  return finalOut;
}

export function readScreenAscii(ppmPath, { cols, rows, crop } = {}) {
  const img = decodeImage(ppmPath);
  const opts = {};
  if (cols != null) opts.cols = cols;
  if (rows != null) opts.rows = rows;
  if (crop != null) opts.crop = crop;
  return toAscii(img, opts);
}

export function screenToImageContent(ppmPath) {
  const ext = path.extname(ppmPath).toLowerCase();
  let pngPath = ppmPath;
  let temp = false;
  if (ext !== '.png') {
    pngPath = path.join(os.tmpdir(), uniqueName('.png'));
    temp = true;
    convertToPng(ppmPath, pngPath);
  }
  try {
    const data = fs.readFileSync(pngPath).toString('base64');
    return { type: 'image', data, mimeType: 'image/png' };
  } finally {
    if (temp) {
      try { fs.unlinkSync(pngPath); } catch {}
    }
  }
}

export async function readScreenText(inputPath, { crop = null } = {}) {
  const ext = path.extname(inputPath).toLowerCase();
  let pngPath = path.resolve(inputPath);
  let tempDir = null;
  if (crop || ext !== '.png') {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qemu-mcp-ocr-'));
    pngPath = path.join(tempDir, 'screen.png');
    const img = decodeImage(inputPath);
    writePng(pngPath, crop ? cropImage(img, crop) : img);
  }
  try {
    return await runOcr(pngPath);
  } finally {
    if (tempDir) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }
}

/** Capture into a private temp directory and remove it afterwards. */
async function withTempCapture(session, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qemu-mcp-cap-'));
  try {
    const ppm = await captureScreen(session, { outDir: dir });
    return await fn(ppm);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

export function captureScreenAscii(session, opts) {
  return withTempCapture(session, (ppm) => readScreenAscii(ppm, opts));
}

/**
 * Prefer exact VGA text memory; fall back to OCR for graphics modes.
 * mode: 'auto' | 'vga' | 'ocr'.
 */
export async function captureScreenText(session, { mode = 'auto', crop = null } = {}) {
  if (mode === 'vga' && crop) {
    throw new Error('crop requires OCR mode; VGA text is read as an 80x25 character grid');
  }
  if (mode !== 'ocr' && !crop) {
    try {
      const vga = await readVgaText(session);
      if (vga && vga.text.trim()) return vga.text;
      if (mode === 'vga') throw new Error('the guest is not in VGA text mode');
    } catch (err) {
      if (mode === 'vga') throw err;
    }
  }
  return withTempCapture(session, (ppm) => readScreenText(ppm, { crop }));
}

/** Capture a PNG in the shots directory and delete the intermediate PPM. */
export async function captureScreenPng(session, { outDir } = {}) {
  const ppm = await captureScreen(session, { outDir });
  try {
    return convertToPng(ppm);
  } finally {
    try { fs.unlinkSync(ppm); } catch {}
  }
}

/** Text plus a saved PNG, so a text model can escalate to a vision model. */
export async function captureScreenTextWithPath(session, { mode = 'auto', crop = null, outDir } = {}) {
  const text = await captureScreenText(session, { mode, crop });
  const path_ = await captureScreenPng(session, { outDir });
  return { text, path: path_ };
}

/** Stable hash of the decoded framebuffer, independent of the PPM header. */
export function hashImage(img) {
  return crypto.createHash('sha1').update(img.data).digest('hex');
}

export function captureScreenHash(session) {
  return (async () => {
    // Text mode hashes the VGA plane (characters plus attributes), which
    // ignores the blinking hardware cursor that makes pixel hashes never
    // settle. A blank or stale text plane must not hide a graphics screen.
    try {
      const vga = await readVgaText(session);
      if (vga && vga.text.trim()) return vga.signature;
    } catch {}
    return withTempCapture(session, (ppm) => hashImage(decodeImage(ppm)));
  })();
}

export function captureScreenSize(session) {
  return withTempCapture(session, (ppm) => {
    const img = decodeImage(ppm);
    return { width: img.width, height: img.height };
  });
}

/**
 * Poll until the framebuffer has not changed for stableMs, or timeoutMs
 * expires. Lets an agent wait for a repaint without OCR.
 */
export async function waitForIdle(session, { stableMs = 1000, timeoutMs = 30000, intervalMs = 250 } = {}) {
  if (!Number.isFinite(stableMs) || stableMs < 0) throw new Error('stableMs must be a non-negative number');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error('timeoutMs must be a non-negative number');
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('intervalMs must be a positive number');

  const start = Date.now();
  let lastHash = null;
  let stableSince = start;
  let samples = 0;

  for (;;) {
    const hash = await captureScreenHash(session);
    samples++;
    const now = Date.now();
    if (hash !== lastHash) {
      lastHash = hash;
      stableSince = now;
    }
    if (now - stableSince >= stableMs) {
      return { idle: true, hash, elapsedMs: now - start, samples };
    }
    const remaining = timeoutMs - (now - start);
    if (remaining <= 0) {
      return { idle: false, hash, elapsedMs: now - start, samples };
    }
    await sleep(Math.min(intervalMs, remaining));
  }
}

export async function waitForText(session, {
  pattern,
  timeoutMs = 5000,
  intervalMs = 250,
  regex = false,
  crop = null,
  mode = 'auto',
} = {}) {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('pattern must be a non-empty string');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error('timeoutMs must be a non-negative number');
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('intervalMs must be a positive number');
  }

  const matcher = regex ? new RegExp(pattern) : (t) => String(t).includes(pattern);
  const start = Date.now();
  let text = '';
  let everRead = false;
  let lastError = null;

  while (true) {
    try {
      text = await captureScreenText(session, { mode, crop });
      everRead = true;
    } catch (err) {
      lastError = err;
      // Retry while nothing has ever been read so a transient OCR failure does
      // not end the wait; at the deadline report the real cause.
      const remaining = timeoutMs - (Date.now() - start);
      if (everRead || remaining <= 0) throw err;
      await sleep(Math.min(intervalMs, remaining));
      continue;
    }
    if (matcher(text)) return { found: true, text, elapsedMs: Date.now() - start };
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  }

  if (!everRead && lastError) throw lastError;
  return { found: false, text, elapsedMs: Date.now() - start };
}
