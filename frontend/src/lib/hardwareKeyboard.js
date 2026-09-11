import getLogger from './logging/Logger.js';
import { DaylightAPI } from './api.mjs';

/**
 * Is there a keyboard to type on?
 *
 * The web platform has no answer. The signal everything reached for instead —
 * `matchMedia('(pointer: fine)')` — asks about a MOUSE, and inferred a keyboard
 * from one because a desktop has both. On a touch panel with a Bluetooth
 * keyboard bonded to it that inference is exactly backwards, and the Portal is
 * precisely that panel: School's Sentence Ladder read it as unable to type and
 * withheld its Dictation and Interpretation rungs, telling a child sitting in
 * front of a Korean/English keyboard to "continue on another device". The whole
 * in-page Hangul IME (`modules/School/ime/`) was built for that panel and could
 * not be reached on it.
 *
 * So this asks the question three ways and takes any yes. None of the three is
 * sufficient alone; each covers where the others are blind:
 *
 *   a mouse        a fine pointer still means a desktop, which has a keyboard.
 *                  Blind to every keyboard on a touch device.
 *   the registry   `devices.yml` declares the Portal's bonded keyboard, and the
 *                  backend answers for the asking device (`/device/self/input`).
 *                  Correct at first paint — no keypress needed — but only for a
 *                  named fleet device, and only as fresh as the file.
 *   a keypress     proof, on any device in the house or out of it, with nothing
 *                  configured. Arrives late by definition: not before the child
 *                  touches a key.
 *
 * A yes is remembered for this browser profile, so the late signal is late only
 * once. There is deliberately no "no": nothing here can distinguish a device
 * with no keyboard from a child who has not yet pressed one, and guessing
 * between those is what caused the bug.
 */

const STORAGE_KEY = 'ds_hardware_keyboard';

/**
 * The keys a hardware keyboard sends that nothing else in this house does.
 *
 * Two impostors have to be kept out. Android's on-screen keyboards report
 * ordinary letters as `keyCode: 229` with an empty `code` — the IME composes
 * the text and the page never sees a key — but they DO send Enter, Backspace
 * and Tab fully formed. A TV remote's D-pad arrives as ArrowUp/ArrowDown/Enter/
 * Escape and would otherwise make every television in the fleet claim a
 * keyboard. What neither can produce is a letter, a digit or a punctuation
 * mark, so those are the whole list.
 */
const TYPING_KEY = /^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9]|Space|Minus|Equal|Bracket(?:Left|Right)|Semicolon|Quote|Comma|Period|Slash|Backslash|Backquote)$/;

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'hardware-keyboard' });
  return _logger;
}

/** A keypress seen in this browser profile, `null` until read from storage. */
let observed = null;
/** The fleet registry's answer, once it has given one. */
let declared = false;
let started = false;
const listeners = new Set();

function remembered() {
  try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

function remember() {
  // A device with storage disabled re-learns on the next keypress. Not worth
  // surfacing: the same key that taught it the first time teaches it again.
  try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch { /* re-learn */ }
}

function pointerFine() {
  try { return window.matchMedia?.('(pointer: fine)')?.matches === true; } catch { return false; }
}

/**
 * @param {KeyboardEvent} event
 * @returns {boolean} true when only a physical keyboard could have sent it
 */
export function isTypingKey(event) {
  if (!event || event.isComposing || event.keyCode === 229) return false;
  if (event.key === 'Unidentified') return false;
  return typeof event.code === 'string' && TYPING_KEY.test(event.code);
}

/**
 * Whether this machine has a keyboard, on the evidence so far.
 * @returns {boolean}
 */
export function hasHardwareKeyboard() {
  if (observed === null) observed = remembered();
  return observed || declared || pointerFine();
}

function announce(via) {
  logger().info('found', { via });
  for (const listener of listeners) {
    try { listener(true); } catch (error) { logger().warn('listener-failed', { via, error: error?.message }); }
  }
}

function onKeyDown(event) {
  if (observed || !isTypingKey(event)) return;
  observed = true;
  remember();
  announce('keypress');
}

async function askRegistry() {
  // Only a screen that knows its fleet name can be looked up; an anonymous
  // browser would be asking about nobody. It also has a mouse, as a rule.
  if (typeof window === 'undefined' || !window.__DAYLIGHT_DEVICE_ID) return;
  try {
    const answer = await DaylightAPI('api/v1/device/self/input');
    if (!answer?.keyboard || declared) return;
    declared = true;
    announce('registry');
  } catch (error) {
    // Silence, not a guess: an unanswered lookup leaves the other two signals
    // to speak. Claiming a keyboard here would strand a learner on an input
    // they do not have.
    logger().warn('registry-lookup-failed', { error: error?.message });
  }
}

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (observed === null) observed = remembered();
  // Capture phase: a rung's own text field stops propagation of the keys it
  // handles, and those are exactly the keystrokes worth learning from.
  window.addEventListener('keydown', onKeyDown, true);
  askRegistry();
}

/**
 * Watch for a keyboard to be discovered. Fires at most once per source, never
 * with `false` — see the note above on why there is no "no".
 *
 * @param {(present: true) => void} onFound
 * @returns {() => void} unsubscribe
 */
export function watchHardwareKeyboard(onFound) {
  listeners.add(onFound);
  start();
  return () => listeners.delete(onFound);
}

export default hasHardwareKeyboard;
