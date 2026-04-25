// frontend/src/screen-framework/input/gamepadFiltering.js
//
// Shared filter for navigator.getGamepads() consumers.
//
// Filters out misclassified HID receivers (mice, keyboards, touchpads) that
// Chromium on Android/Shield TV reports as gamepads. Returns ALL plausible
// gamepads — multiple physical controllers (two 8Bitdos, etc.) all flow
// through to consumers. Phantom-enumeration suppression (one physical device
// reported at two indices) is handled downstream by GamepadAdapter via a
// short same-id cooldown, NOT by collapsing here.

const NON_GAMEPAD_PATTERNS = /mouse|keyboard|touchpad|trackball|presenter/i;

export function isPlausibleGamepad(gp) {
  if (!gp) return false;
  if (NON_GAMEPAD_PATTERNS.test(gp.id)) return false;
  // Real gamepads have at least a 4-button face cluster + a stick or d-pad axis pair
  if (gp.buttons.length < 4 || gp.axes.length < 2) return false;
  return true;
}

export function getActiveGamepads() {
  const raw = (typeof navigator !== 'undefined' && navigator.getGamepads)
    ? navigator.getGamepads()
    : [];
  const out = [];
  for (const gp of raw) {
    if (!isPlausibleGamepad(gp)) continue;
    out.push(gp);
  }
  return out;
}
