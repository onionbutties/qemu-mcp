// OCR provider selection: Windows OCR on Windows, Tesseract elsewhere.
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const OCR_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ocr.ps1');

function requestedProvider() {
  const value = process.env.QEMU_MCP_OCR || 'auto';
  if (value === 'auto') return process.platform === 'win32' ? 'windows' : 'tesseract';
  if (value === 'windows' || value === 'tesseract') return value;
  throw new Error(`unknown OCR provider: ${value}`);
}

function commandAvailable(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore', windowsHide: true });
  return result.status === 0;
}

export function ocrProvider() {
  return requestedProvider();
}

export function isOcrAvailable(provider = requestedProvider()) {
  if (provider === 'windows') {
    return process.platform === 'win32'
      && commandAvailable('powershell.exe', ['-NoProfile', '-Command', 'exit 0']);
  }
  if (provider === 'tesseract') {
    return commandAvailable(process.env.QEMU_MCP_TESSERACT || 'tesseract');
  }
  return false;
}

export function ocrCommand(provider, imagePath) {
  if (provider === 'windows') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-File', OCR_SCRIPT, '-Path', imagePath],
    };
  }
  if (provider === 'tesseract') {
    return {
      command: process.env.QEMU_MCP_TESSERACT || 'tesseract',
      args: [
        imagePath,
        'stdout',
        '-l', process.env.QEMU_MCP_OCR_LANG || 'eng',
        '--psm', process.env.QEMU_MCP_OCR_PSM || '6',
      ],
    };
  }
  throw new Error(`unknown OCR provider: ${provider}`);
}

export async function runOcr(imagePath, { provider = requestedProvider() } = {}) {
  try {
    if (provider === 'windows' && process.platform !== 'win32') {
      throw new Error('Windows OCR requires Windows');
    }
    const { command, args } = ocrCommand(provider, imagePath);
    const { stdout } = await execFileAsync(command, args, {
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true,
    });
    return String(stdout ?? '').trim();
  } catch (err) {
    const stderr = err && err.stderr ? String(err.stderr).trim() : '';
    throw new Error(`OCR failed (${provider})${stderr ? ': ' + stderr : ': ' + (err?.message ?? err)}`);
  }
}
