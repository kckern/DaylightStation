/**
 * ejsContract — the single declaration of every EmulatorJS internal we reach into.
 *
 * WHY THIS EXISTS: EmulatorJS is vendored (media/emulation/_engine, currently
 * 4.2.3), not an npm dependency — it is invisible to `git log`, `npm audit`, and
 * every dependency tool. We monkey-patch and read its PRIVATE, MINIFIED state in
 * several places, so an upgrade that renames a field breaks gameplay silently.
 *
 * On 2026-08-15 exactly that class of failure cost an evening: `gamepadSelection`
 * was never populated, so `gamepadEvent` discarded every input while the browser
 * happily reported the pad as connected. Nothing failed — it just stopped working.
 *
 * Asserting the contract at boot converts that silent breakage into a loud,
 * immediate error naming the exact missing path.
 */

/**
 * Every EmulatorJS internal the app depends on, with the type we expect.
 *
 * Keep this list in sync with actual usage — an entry here is a promise that some
 * code path reads it. Current consumers:
 *   started                            — bootSettle's barrier; EJS's own gamepadEvent guard
 *   volume                             — bootSettle verifies our level survived EJS's start
 *   gamepadSelection                   — claimGamepads writes the pad→player slot mapping
 *   gamepad.gamepads                   — the pads EJS actually sees
 *   gameManager.functions.simulateInput — tapInput wraps this to observe consumed input
 *   setVolume                          — engine.setVolume delegates here
 */
export const EJS_CONTRACT = [
  { path: 'started', type: 'boolean' },
  { path: 'volume', type: 'number' },
  { path: 'gamepadSelection', type: 'array' },
  { path: 'gamepad.gamepads', type: 'array' },
  { path: 'gameManager.functions.simulateInput', type: 'function' },
  { path: 'setVolume', type: 'function' },
];

/**
 * Read a dotted path off an object without throwing on a missing intermediate.
 *
 * @param {object} root
 * @param {string} path dotted, e.g. 'gameManager.functions.simulateInput'
 * @returns {*} the value, or undefined if any hop is missing
 */
export function readPath(root, path) {
  if (!root || typeof path !== 'string') return undefined;
  let cur = root;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    try {
      cur = cur[seg];
    } catch {
      return undefined;
    }
  }
  return cur;
}

/**
 * True when `value` matches the contract's expected type. `array` is checked with
 * Array.isArray because typeof [] === 'object'.
 *
 * @param {*} value
 * @param {string} type one of 'boolean' | 'number' | 'array' | 'function' | 'object'
 * @returns {boolean}
 */
export function matchesType(value, type) {
  if (value === undefined || value === null) return false;
  if (type === 'array') return Array.isArray(value);
  return typeof value === type;  
}

/**
 * Verify the running EmulatorJS instance still exposes everything we depend on.
 *
 * Pure and side-effect free — the caller decides how loudly to complain, so this
 * stays testable without a logger.
 *
 * @param {object} instance the live EJS_emulator instance
 * @param {object} [opts]
 * @param {string|null} [opts.version] engine version, for provenance in the report
 * @param {Array<{path:string,type:string}>} [opts.contract] override for testing
 * @returns {{ok: boolean, missing: Array<{path:string, expected:string, actual:string}>, version: string|null}}
 */
export function assertEjsContract(instance, { version = null, contract = EJS_CONTRACT } = {}) {
  const missing = [];
  if (!instance) {
    return {
      ok: false,
      missing: contract.map((c) => ({ path: c.path, expected: c.type, actual: 'no-instance' })),
      version,
    };
  }
  for (const { path, type } of contract) {
    const value = readPath(instance, path);
    if (!matchesType(value, type)) {
      missing.push({
        path,
        expected: type,
        actual: value === undefined ? 'undefined' : (Array.isArray(value) ? 'array' : typeof value),
      });
    }
  }
  return { ok: missing.length === 0, missing, version };
}
