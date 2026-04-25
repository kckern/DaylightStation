// frontend/src/screen-framework/input/gamepadFiltering.js
//
// Shared filter + dedupe for navigator.getGamepads() consumers.
//
// Why this exists:
// 1. Some HID receivers (mice, keyboards, touchpads) get classified as
//    gamepads by Chromium on Android/Shield TV and pollute getGamepads()
//    with phantom devices that have no real face buttons. Polling them
//    is wasted work and risks accidental input if a button index lights
//    up from scroll-wheel / pointer events.
// 2. A single physical controller can enumerate twice (e.g. an 8Bitdo
//    SN30 Pro on Shield TV appears at index 1 AND index 2 simultaneously).
//    Naively iterating navigator.getGamepads() then makes one physical
//    button press fire its handler twice.

const NON_GAMEPAD_PATTERNS = /mouse|keyboard|touchpad|trackball|presenter/i;

export function isPlausibleGamepad(gp) {
  if (!gp) return false;
  if (NON_GAMEPAD_PATTERNS.test(gp.id)) return false;
  // Real gamepads have at least a 4-button face cluster + a stick or d-pad axis pair
  if (gp.buttons.length < 4 || gp.axes.length < 2) return false;
  return true;
}

/**
 * Returns one entry per physical gamepad: filters out misclassified HID
 * devices and dedupes slots that share an `id`.
 *
 * Dedupe rationale: when the same `id` shows up at two indices the
 * overwhelming likelihood is one physical device enumerated twice (kernel
 * quirk, XInput shim, or duplicate HID interface). The rare case of two
 * literal identical controllers gets last-write-wins, which is acceptable
 * for a household TV remote.
 */
export function getActiveGamepads() {
  const raw = (typeof navigator !== 'undefined' && navigator.getGamepads)
    ? navigator.getGamepads()
    : [];
  const seen = new Set();
  const out = [];
  for (const gp of raw) {
    if (!isPlausibleGamepad(gp)) continue;
    if (seen.has(gp.id)) continue;
    seen.add(gp.id);
    out.push(gp);
  }
  return out;
}
