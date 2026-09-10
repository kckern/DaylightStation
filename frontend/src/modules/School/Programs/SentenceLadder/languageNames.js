/**
 * Language codes, in words.
 *
 * The corpus writes its own codes (`EN`, `KR`) and they are not BCP-47, so
 * `Intl.DisplayNames` cannot name them. An explicit map, falling back to the
 * code itself — a card saying "Needs a KR keyboard" is poor, and a card
 * confidently saying the WRONG language is worse.
 *
 * It lives here rather than in either caller because both the blocked-rung note
 * and the device panel name the same object, two taps apart: the note sends a
 * child to "a Korean keyboard" and the panel is where they go turn it on. Those
 * had drifted — the note said "Korean" while the panel's row said "KR", even
 * though DeviceSettings exists precisely to use "words rather than codes".
 * One map, so the two surfaces cannot disagree again.
 *
 * Deliberately hardcoded to the two languages the corpus in play uses. A third
 * belongs here as a line of code, not as a config file.
 */
const LANGUAGE_NAMES = { EN: 'English', KR: 'Korean' };

/** The language's name, or the raw code when we have no name for it. */
export function languageName(code) {
  return LANGUAGE_NAMES[code] ?? code;
}

export default LANGUAGE_NAMES;
