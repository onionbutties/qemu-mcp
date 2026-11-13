// Thin wrappers over tools/fatimg.mjs for the QEMU MCP disk tools.
// Adds path validation and consistent, prefixed error messages.
import fs from 'node:fs';
import { listImage, readImage, buildImage } from '../../tools/fatimg.mjs';

function requireNonEmptyString(value, fnName, paramName) {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${fnName}: ${paramName} must be a non-empty string`);
  }
}

export function listFatImage(imagePath) {
  requireNonEmptyString(imagePath, 'listFatImage', 'imagePath');
  try {
    return listImage(imagePath);
  } catch (err) {
    throw new Error(`listFatImage: ${err && err.message ? err.message : err}`);
  }
}

export function readFatFile(imagePath, dosPath) {
  requireNonEmptyString(imagePath, 'readFatFile', 'imagePath');
  requireNonEmptyString(dosPath, 'readFatFile', 'dosPath');
  // Stricter than readImage: a trailing separator is a mistake, not a tolerant
  // alias for the file it names.
  if (/[\\/]+$/.test(dosPath)) {
    throw new Error('readFatFile: dosPath must not end with a path separator');
  }
  try {
    return readImage(imagePath, dosPath);
  } catch (err) {
    throw new Error(`readFatFile: ${err && err.message ? err.message : err}`);
  }
}

export function buildFatImage(outPath, spec) {
  requireNonEmptyString(outPath, 'buildFatImage', 'outPath');
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('buildFatImage: spec must be an object');
  }
  try {
    return buildImage(outPath, spec);
  } catch (err) {
    throw new Error(`buildFatImage: ${err && err.message ? err.message : err}`);
  }
}