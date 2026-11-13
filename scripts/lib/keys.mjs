// QEMU human-monitor key names for ASCII characters.
// Reference: qemu/ui/keymaps.c QKeyCode list.

const PLAIN = {
  ' ': 'spc',
  '\n': 'ret',
  '\r': 'ret',
  '\t': 'tab',
  '-': 'minus',
  '=': 'equal',
  '[': 'bracket_left',
  ']': 'bracket_right',
  '\\': 'backslash',
  ';': 'semicolon',
  "'": 'apostrophe',
  '`': 'grave_accent',
  ',': 'comma',
  '.': 'dot',
  '/': 'slash',
};

const SHIFTED = {
  '!': '1',
  '@': '2',
  '#': '3',
  '$': '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  '_': 'minus',
  '+': 'equal',
  '{': 'bracket_left',
  '}': 'bracket_right',
  '|': 'backslash',
  ':': 'semicolon',
  '"': 'apostrophe',
  '~': 'grave_accent',
  '<': 'comma',
  '>': 'dot',
  '?': 'slash',
};

/** Map one character to a QEMU sendkey token, or throw. */
export function charToKey(ch) {
  if (/^[a-z0-9]$/.test(ch)) return ch;
  if (/^[A-Z]$/.test(ch)) return 'shift-' + ch.toLowerCase();
  if (PLAIN[ch]) return PLAIN[ch];
  if (SHIFTED[ch]) return 'shift-' + SHIFTED[ch];
  const code = ch.codePointAt(0);
  throw new Error(`no key mapping for ${JSON.stringify(ch)} (U+${code.toString(16)})`);
}

/** Split text into individual sendkey tokens. */
export function textToKeys(text) {
  return Array.from(text).map(charToKey);
}
