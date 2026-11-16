// Bounded text buffer for QEMU stdout/stderr.
export function createLogBuffer({ maxBytes = 64 * 1024 } = {}) {
  let text = '';
  return {
    push(chunk) {
      if (!chunk) return;
      text += String(chunk);
      if (text.length > maxBytes) text = text.slice(text.length - maxBytes);
    },
    text: () => text,
    lines(n = 50) {
      const rows = text.split(/\r?\n/);
      if (rows.length && rows[rows.length - 1] === '') rows.pop();
      return rows.slice(-n);
    },
  };
}
