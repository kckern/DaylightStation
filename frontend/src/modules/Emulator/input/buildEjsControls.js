/**
 * buildEjsControls — translate a config-driven keyboard map into the
 * `EJS_defaultControls` object EmulatorJS consumes at boot.
 *
 * Pure + side-effect free. EmulatorJS controls are
 *   EJS_defaultControls = { 0:{...}, 1:{}, 2:{}, 3:{} }   (players 0-3)
 * where each player maps a numeric CONTROL INDEX to
 *   { value: <ejsKeyName>, value2: <gamepadButton> }.
 *
 * The index->button scheme + default gamepad button (value2) below is verified
 * against a real EmulatorJS build — do not guess/reorder these.
 */

/** Semantic button name -> EmulatorJS control index. */
export const SEMANTIC_INDEX = {
  b: 0,
  y: 1,
  select: 2,
  start: 3,
  up: 4,
  down: 5,
  left: 6,
  right: 7,
  a: 8,
  x: 9,
  l: 10,
  r: 11,
};

/**
 * Control index -> default gamepad button (EmulatorJS `value2`). Only indices
 * 0-11 are emitted; 12/13 (L2/R2) are intentionally omitted so the produced
 * controls object stays aligned with SEMANTIC_INDEX.
 */
export const GAMEPAD_DEFAULT = {
  0: 'BUTTON_2',
  1: 'BUTTON_4',
  2: 'SELECT',
  3: 'START',
  4: 'DPAD_UP',
  5: 'DPAD_DOWN',
  6: 'DPAD_LEFT',
  7: 'DPAD_RIGHT',
  8: 'BUTTON_1',
  9: 'BUTTON_3',
  10: 'LEFT_TOP_SHOULDER',
  11: 'RIGHT_TOP_SHOULDER',
};

/** Friendly (KeyboardEvent.key-style) name -> EmulatorJS lowercase key name. */
const NAMED_KEYS = {
  ArrowUp: 'up arrow',
  ArrowDown: 'down arrow',
  ArrowLeft: 'left arrow',
  ArrowRight: 'right arrow',
  Enter: 'enter',
  Space: 'space',
  Tab: 'tab',
  Shift: 'shift',
};

/**
 * Convert a config-friendly key name (e.g. `ArrowUp`, `Enter`, `x`) into the
 * lowercase string EmulatorJS expects. Unknown values are simply lowercased
 * (covers single letters). Nullish/empty -> ''.
 *
 * @param {string} friendly
 * @returns {string}
 */
export function normalizeKeyName(friendly) {
  if (!friendly) return '';
  if (Object.prototype.hasOwnProperty.call(NAMED_KEYS, friendly)) {
    return NAMED_KEYS[friendly];
  }
  return String(friendly).toLowerCase();
}

/**
 * Build the EJS_defaultControls object from a semantic keyboard map.
 *
 * Every index 0-11 is present so the gamepad still works for buttons the
 * keyboard map didn't bind (those get `value: ''` plus the default gamepad
 * button). Players 1-3 are empty objects.
 *
 * @param {Record<string,string>} keyboardMap  semantic -> friendly key name.
 * @returns {{0: object, 1: object, 2: object, 3: object}}
 */
export function buildEjsControls(keyboardMap = {}, gamepadMap = {}) {
  const player0 = {};

  // Seed every index with its gamepad default + empty keyboard value.
  for (const index of Object.keys(GAMEPAD_DEFAULT)) {
    player0[index] = { value: '', value2: GAMEPAD_DEFAULT[index] };
  }

  // Overlay gamepad (value2) overrides for recognized semantic names. Lets config
  // remap a control to a stick axis instead of a button — e.g. controllers whose
  // D-pad reports on the left stick axes (LEFT_STICK_X/Y:±1), like the 8BitDo SFC30.
  for (const [semantic, value2] of Object.entries(gamepadMap || {})) {
    const index = SEMANTIC_INDEX[semantic];
    if (index === undefined || !value2) continue;
    player0[index].value2 = String(value2);
  }

  // Overlay keyboard bindings for recognized semantic names (keep value2 as set).
  for (const [semantic, key] of Object.entries(keyboardMap)) {
    const index = SEMANTIC_INDEX[semantic];
    if (index === undefined) continue;
    player0[index].value = normalizeKeyName(key);
  }

  return { 0: player0, 1: {}, 2: {}, 3: {} };
}
