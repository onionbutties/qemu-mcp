import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.join(MODULE_DIR, 'macros');

function resolveDir(dir) {
  return dir ? path.resolve(dir) : DEFAULT_DIR;
}

export async function listMacros(dir) {
  const target = resolveDir(dir);
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => entry.name.slice(0, -'.mjs'.length))
    .sort();
}

function validateName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('macro name must be a non-empty string');
  }
  if (name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) {
    throw new Error(`invalid macro name: ${name}`);
  }
  return name;
}

export async function runMacro(name, session, args = {}, dir) {
  const safeName = validateName(name);
  const target = resolveDir(dir);
  const filePath = path.join(target, `${safeName}.mjs`);
  const stat = await fs.stat(filePath);
  const moduleUrl = `${pathToFileURL(filePath).href}?v=${stat.mtimeMs}`;
  const mod = await import(moduleUrl);
  const fn = mod && mod.default;
  if (typeof fn !== 'function') {
    throw new Error(`macro "${safeName}" has no default export function`);
  }
  return fn(session, args ?? {});
}
