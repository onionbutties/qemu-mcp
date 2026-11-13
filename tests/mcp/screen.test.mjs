import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readScreenAscii, readScreenText } from '../../scripts/mcp/screen.mjs';
import { isOcrAvailable } from '../../tools/ocr.mjs';

const ppm = path.join(process.cwd(), 'tests', 'fixtures', '02-setup.ppm');

test('readScreenAscii returns non-empty text for an existing screenshot', () => {
  const ascii = readScreenAscii(ppm, { cols: 40 });
  assert.ok(ascii.length > 0);
});

test('readScreenText converts and OCRs an existing PPM', { skip: !isOcrAvailable() }, async () => {
  const text = await readScreenText(ppm);
  assert.equal(typeof text, 'string');
});
