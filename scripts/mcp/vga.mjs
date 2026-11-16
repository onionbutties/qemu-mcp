// Read an 80x25 VGA text screen from guest memory. Exact characters, no OCR.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// CP437 glyphs for bytes 0x80-0xFF.
const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅ'
  + 'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ'
  + 'áíóúñÑªº¿⌐¬½¼¡«»'
  + '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐'
  + '└┴┬├─┼╞╟╚╔╩╦╠═╬╧'
  + '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀'
  + 'αßΓπΣσµτΦΘΩδ∞φε∩'
  + '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

export const VGA_TEXT_BYTES = 80 * 25 * 2;

function cellChar(code) {
  if (code === 0) return ' ';
  if (code >= 0x20 && code < 0x7f) return String.fromCharCode(code);
  if (code >= 0x80) return CP437_HIGH[code - 0x80] ?? '?';
  return '?';
}

/**
 * Decode a 4000-byte VGA text buffer. Returns null when the memory does not
 * look like text mode, so callers can fall back to OCR.
 */
export function decodeVgaText(buf, { columns = 80, rows = 25 } = {}) {
  const need = columns * rows * 2;
  if (!buf || buf.length < need) return null;
  let printable = 0;
  const lines = [];
  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let col = 0; col < columns; col++) {
      const code = buf[(row * columns + col) * 2];
      if (code === 0 || (code >= 0x20 && code !== 0x7f)) printable++;
      line += cellChar(code);
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  if (printable / (columns * rows) < 0.95) return null;
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return { text: lines.join('\n'), columns, rows };
}

/** Only 80x25 colour text (BIOS modes 2 and 3) matches the decoder. */
export function isTextMode(mode) {
  return mode === 0x02 || mode === 0x03;
}

/** Copy the text plane out of guest memory and decode it. */
export async function readVgaText(session) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qemu-mcp-vga-'));
  try {
    const modeFile = path.join(dir, 'mode.bin');
    await session.qmp('pmemsave', { val: 0x449, size: 1, filename: modeFile });
    const mode = fs.readFileSync(modeFile)[0];
    // Do not trust a stale text plane left behind after a switch to graphics.
    if (!isTextMode(mode)) return null;

    const textFile = path.join(dir, 'text.bin');
    await session.qmp('pmemsave', { val: 0xb8000, size: VGA_TEXT_BYTES, filename: textFile });
    const buf = fs.readFileSync(textFile);
    const decoded = decodeVgaText(buf);
    if (!decoded) return null;
    // The raw plane includes attributes, so an attribute-only repaint changes
    // the signature while the blinking hardware cursor does not.
    return { ...decoded, signature: crypto.createHash('sha1').update(buf).digest('hex') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
