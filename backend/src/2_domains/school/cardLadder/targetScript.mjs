/**
 * The TARGET side's writing system — the one seam between the generic card
 * ladder and script-specific behaviour. Pure.
 *
 * A card has two sides: the TARGET (what is being acquired, typed from memory
 * at sign-off) and the ANCHOR (what the learner already holds it by). Only the
 * target is ever typed, so only the target's script shapes the typed judge,
 * the on-screen keypad and the IME. Today one script has special handling:
 * `hangul` (keystroke-jamo distance, the "no Hangul typed" floor, the jamo
 * keypad). Every other target is `generic`: code points, no script floor, no
 * keypad. Adding a script (its normalizer, keypad, IME) plugs in here.
 */
import { hasHangul, keystrokeJamo } from './jamo.mjs';

export const HANGUL_SCRIPT = 'hangul';
export const GENERIC_SCRIPT = 'generic';

/** Primary language subtag → script, for the languages that need their own handling. */
const SCRIPT_BY_LANGUAGE = Object.freeze({ ko: HANGUL_SCRIPT });

/** The script a BCP-47 language code is typed in (`ko`, `ko-KR` → hangul; anything else → generic). */
export function scriptFor(languageCode) {
  const primary = String(languageCode ?? '').split('-')[0].toLowerCase();
  return Object.hasOwn(SCRIPT_BY_LANGUAGE, primary) ? SCRIPT_BY_LANGUAGE[primary] : GENERIC_SCRIPT;
}

/** The script a piece of target text is written in, when no language was given. */
export function scriptOfText(text) {
  return hasHangul(text) ? HANGUL_SCRIPT : GENERIC_SCRIPT;
}

/** The units a typed-answer distance is counted in: keystrokes for Hangul, code points otherwise. */
export function keystrokeUnits(text, script) {
  return script === HANGUL_SCRIPT ? keystrokeJamo(text) : [...String(text ?? '')];
}

/**
 * Whether a typed answer is written in the target's script at all. Only Hangul
 * has a floor (an answer with no Hangul in it cannot be the Korean word); a
 * generic target accepts any text and lets the distance decide.
 */
export function writtenInScript(text, script) {
  return script === HANGUL_SCRIPT ? hasHangul(text) : true;
}
