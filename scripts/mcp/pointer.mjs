// Absolute pointer helpers for QMP input-send-event.
export const POINTER_MAX = 0x7fff;

export const MOUSE_BUTTONS = new Set(['left', 'middle', 'right', 'wheel-up', 'wheel-down', 'side', 'extra']);

/** Map a pixel coordinate to QEMU's 0..0x7fff absolute axis range. */
export function absoluteAxis(value, size) {
  if (!Number.isFinite(value) || !Number.isFinite(size) || size <= 1) {
    throw new Error('absoluteAxis: value and size must describe a real screen');
  }
  const clamped = Math.max(0, Math.min(size - 1, value));
  return Math.round((clamped / (size - 1)) * POINTER_MAX);
}
