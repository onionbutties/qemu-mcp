export function textResult(result) {
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  return { content: [{ type: 'text', text }] };
}

export function errorResult(err) {
  const message = err && err.message ? err.message : String(err);
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }) }] };
}
