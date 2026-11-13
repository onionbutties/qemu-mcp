// Screen capture helpers for the QEMU MCP server.
// Wraps screendump, PNG conversion, OCR, ASCII rendering, and wait_for_text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { decodeImage, toAscii } from '../../tools/imgpeek.mjs';
import { writePng } from '../../tools/ppm2png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OCR_SCRIPT = path.join(ROOT, 'tools', 'ocr.ps1');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueName(ext = '.ppm') {
  const rand = Math.random().toString(36).slice(2, 10);
  return `screen-${Date.now()}-${rand}${ext}`;
}

export async function captureScreen(session, { outDir } = {}) {
  const dir = outDir
    ? path.resolve(outDir)
    : path.join(ROOT, 'vm', 'shots', 'mcp');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, uniqueName('.ppm'));

  // Prefer screendump implementations that poll for the output file (monitor.screendump,
  // up to ~4s) over the short command fallbacks that return immediately.
  if (typeof session?.screendump === 'function') {
    await session.screendump(file);
  } else if (session?.mon && typeof session.mon.screendump === 'function') {
    await session.mon.screendump(file);
  } else if (typeof session?.monitor === 'function') {
    const mon = await session.monitor();
    if (typeof mon?.screendump === 'function') await mon.screendump(file);
    else if (typeof mon?.cmd === 'function') await mon.cmd('screendump ' + file);
    else if (typeof mon?.command === 'function') await mon.command('screendump ' + file);
    else throw new Error('session does not support screendump');
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
  return file;
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

export function readScreenText(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  let pngPath = path.resolve(inputPath);
  let temp = false;
  if (ext !== '.png') {
    pngPath = path.join(os.tmpdir(), uniqueName('.png'));
    temp = true;
    convertToPng(inputPath, pngPath);
  }
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-File', OCR_SCRIPT, '-Path', pngPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });
    return String(out ?? '').trim();
  } finally {
    if (temp) {
      try { fs.unlinkSync(pngPath); } catch {}
    }
  }
}

export async function waitForText(session, { pattern, timeoutMs = 5000, intervalMs = 250, regex = false } = {}) {
  const start = Date.now();
  let text = '';
  let found = false;
  const matcher = regex ? (t) => new RegExp(pattern).test(t) : (t) => String(t).includes(pattern);

  while (true) {
    try {
      const ppm = await captureScreen(session);
      text = readScreenText(ppm);
    } catch {
      // stop polling if capture/read fails
      break;
    }
    try {
      if (matcher(text)) {
        found = true;
        break;
      }
    } catch {
      break;
    }
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
    if (Date.now() - start >= timeoutMs) break;
  }

  return { found, text, elapsedMs: Date.now() - start };
}
