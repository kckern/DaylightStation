/**
 * The TARGET side's script — the client half of the card ladder's one
 * script seam (backend twin: `2_domains/school/cardLadder/targetScript.mjs`).
 * The target is the side being acquired and the only side ever typed, so its
 * script alone decides whether an on-screen keypad exists. Today only Hangul
 * has one (the 두벌식 jamo keypad); any other target is typed on the device's
 * own keyboard. A new script plugs its keypad in here.
 */
import JamoKeypad from './JamoKeypad.jsx';

export const HANGUL_SCRIPT = 'hangul';
export const GENERIC_SCRIPT = 'generic';

const SCRIPT_BY_LANGUAGE = Object.freeze({ ko: HANGUL_SCRIPT });

/** A BCP-47 language code's script (`ko`, `ko-KR` → hangul; anything else → generic). */
export function scriptFor(languageCode) {
  const primary = String(languageCode ?? '').split('-')[0].toLowerCase();
  return Object.hasOwn(SCRIPT_BY_LANGUAGE, primary) ? SCRIPT_BY_LANGUAGE[primary] : GENERIC_SCRIPT;
}

/** The on-screen keypad component for a target script, or null when it has none. */
export function keypadFor(script) {
  return script === HANGUL_SCRIPT ? JamoKeypad : null;
}

/**
 * The sitting's two sides' languages from an open response: `target`/`anchor`
 * when the server sends them, else the pre-rename `language`/`gloss` names.
 */
export function sidesFromOpen(data) {
  const target = data?.target?.code ?? data?.language?.code ?? null;
  const anchor = data?.anchor?.code ?? data?.gloss?.code ?? null;
  return { target, anchor, targetScript: data?.target?.script ?? scriptFor(target) };
}
