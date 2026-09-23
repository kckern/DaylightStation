/**
 * The TARGET side's writing system — the one seam between the generic card
 * ladder and script-specific behaviour. Pure.
 *
 * A card has two sides: the TARGET (what is being acquired, typed from memory
 * at sign-off) and the ANCHOR (what the learner already holds it by). Only the
 * target is ever typed, so only the target's script shapes the typed judge,
 * the on-screen keypad and the IME. The per-script rules (normalize, distance
 * units, script floor, keypad) live in `scriptRules.mjs`; this module is the
 * stable façade the rest of the ladder imports.
 */
import { ruleFor } from './scriptRules.mjs';

export { HANGUL_SCRIPT, LATIN_SCRIPT, GENERIC_SCRIPT, SCRIPTS, scriptFor, scriptOfText } from './scriptRules.mjs';

/** The units a typed-answer distance is counted in: keystroke jamo for Hangul, letters (accents stripped) for Latin, graphemes otherwise. */
export function keystrokeUnits(text, script) {
  return ruleFor(script).units(text);
}

/**
 * Whether a typed answer is written in the target's script at all. Hangul,
 * Latin, Cyrillic, Greek, Han, kana and Arabic each have a floor; an unknown
 * (`generic`) language accepts any text and lets the distance decide.
 */
export function writtenInScript(text, script) {
  return ruleFor(script).isOfScript(text);
}
