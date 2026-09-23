/**
 * The TARGET side's script — the client half of the card ladder's one
 * script seam (backend twin: `2_domains/school/cardLadder/targetScript.mjs`).
 * The target is the side being acquired and the only side ever typed, so its
 * script alone decides whether an on-screen keypad exists. Only Hangul has
 * one (the 두벌식 jamo keypad); Latin, Cyrillic, Greek, Han, kana, Arabic and
 * unknown (`generic`) targets are typed on the device's own keyboard/IME. The
 * language → script table mirrors the backend's `scriptRules.mjs`.
 */
import JamoKeypad from './JamoKeypad.jsx';

export const HANGUL_SCRIPT = 'hangul';
export const LATIN_SCRIPT = 'latin';
export const GENERIC_SCRIPT = 'generic';

// Mirror of backend/src/2_domains/school/cardLadder/scriptRules.mjs LANGUAGES.
const LANGUAGES = {
  hangul: ['ko'],
  latin: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'sv', 'no', 'nb', 'nn', 'da', 'fi', 'is', 'pl', 'cs', 'sk', 'sl', 'hr', 'bs',
    'ro', 'hu', 'tr', 'vi', 'id', 'ms', 'tl', 'fil', 'la', 'ca', 'eu', 'gl', 'ga', 'cy', 'sq', 'et', 'lv', 'lt', 'mt', 'af', 'sw',
    'yo', 'ha', 'zu', 'xh', 'eo', 'haw', 'mi', 'sm', 'to'],
  cyrillic: ['ru', 'uk', 'be', 'bg', 'sr', 'mk', 'kk', 'ky', 'mn', 'tg'],
  greek: ['el', 'grc'],
  han: ['zh', 'yue'],
  kana: ['ja'],
  arabic: ['ar', 'fa', 'ur', 'ps'],
};
const SCRIPT_BY_LANGUAGE = Object.freeze(Object.fromEntries(
  Object.entries(LANGUAGES).flatMap(([script, codes]) => codes.map((code) => [code, script])),
));

/** A BCP-47 language code's script (`ko-KR` → hangul, `en` → latin; unknown → generic). */
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
