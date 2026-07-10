// Zone map for a bare tap on the (non-fullscreen) video surface: left third
// rewinds, middle third toggles pause, right third advances. The tap itself is
// the control — no transport overlay outside fullscreen.
export const TAP_SKIP_SECONDS = 15;

/**
 * @param {number} x - tap offset from the surface's left edge, px
 * @param {number} width - surface width, px
 * @returns {'back'|'toggle'|'forward'}
 */
export function videoTapAction(x, width) {
  if (!(width > 0)) return 'toggle';
  const ratio = x / width;
  if (ratio < 1 / 3) return 'back';
  if (ratio > 2 / 3) return 'forward';
  return 'toggle';
}
