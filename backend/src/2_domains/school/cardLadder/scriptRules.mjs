/**
 * Per-script grading rules for the card ladder's typed judge — small pure
 * strategy objects, one per writing system of the TARGET side (the side
 * typed at sign-off). Selected by `scriptFor(target language)`, or read off
 * the target text when no language is given. Pure: Intl and RegExp only.
 *
 * Each rule has:
 *   normalize(text)  the answer as compared: exact match, other-word guard,
 *                    copy steps, the model's `attempt`.
 *   units(text)      what the edit distance counts (on normalized text).
 *   isOfScript(text) whether the text contains any letter of this script.
 *   short(text)      the units "short" is counted in (≤ 2 is deterministic).
 *   fold(text)       optional: a looser key whose equality is a small slip
 *                    (Latin: diacritics stripped — "cafe" for "café").
 *   keypad           the on-screen keypad id, or null.
 *
 * Owner ruling 2026-09-23: Latin is case-insensitive, accents are a small
 * slip, numbers must be exact; Hangul is graded exactly as before.
 */
import { hasHangul, keystrokeJamo, normalizeAnswer } from './jamo.mjs';

export const HANGUL_SCRIPT = 'hangul';
export const LATIN_SCRIPT = 'latin';
export const GENERIC_SCRIPT = 'generic';
export const SCRIPTS = Object.freeze(['hangul', 'latin', 'cyrillic', 'greek', 'han', 'kana', 'arabic', 'generic']);

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
/** Primary language subtag → script. */
export const SCRIPT_BY_LANGUAGE = Object.freeze(Object.fromEntries(
  Object.entries(LANGUAGES).flatMap(([script, codes]) => codes.map((code) => [code, script])),
));

/** The script a BCP-47 language code is typed in (`ko-KR` → hangul, `en` → latin; unknown → generic). */
export function scriptFor(languageCode) {
  const primary = String(languageCode ?? '').split('-')[0].toLowerCase();
  return Object.hasOwn(SCRIPT_BY_LANGUAGE, primary) ? SCRIPT_BY_LANGUAGE[primary] : GENERIC_SCRIPT;
}

const LETTERS = {
  latin: /\p{Script=Latin}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  greek: /\p{Script=Greek}/u,
  han: /\p{Script=Han}/u,
  // Japanese is written in kana and kanji together.
  kana: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  arabic: /\p{Script=Arabic}/u,
};
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** The script a piece of target text is written in, when no language was given. */
export function scriptOfText(text) {
  const value = String(text ?? '');
  if (hasHangul(value)) return HANGUL_SCRIPT;
  if (KANA.test(value)) return 'kana';
  for (const script of ['han', 'cyrillic', 'greek', 'arabic', 'latin']) if (LETTERS[script].test(value)) return script;
  return GENERIC_SCRIPT;
}

const MAX_ANSWER = 80;
/** NFC, capped, punctuation stripped, whitespace collapsed and trimmed, case-folded. */
function normalizeText(text) {
  return [...String(text ?? '').normalize('NFC')].slice(0, MAX_ANSWER).join('')
    .replace(/\p{P}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}
const stripMarks = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');

const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
/** Grapheme clusters (Intl.Segmenter), falling back to code points. */
export function graphemes(text) {
  const value = String(text ?? '');
  return segmenter ? Array.from(segmenter.segment(value), (part) => part.segment) : [...value];
}

const hangulRule = Object.freeze({
  script: HANGUL_SCRIPT,
  normalize: normalizeAnswer,
  units: keystrokeJamo,
  isOfScript: hasHangul,
  short: (text) => [...normalizeAnswer(text)],
  fold: null,
  keypad: 'jamo',
});

const latinRule = Object.freeze({
  script: LATIN_SCRIPT,
  normalize: normalizeText,
  units: (text) => [...stripMarks(text)],
  isOfScript: (text) => LETTERS.latin.test(String(text ?? '')),
  short: (text) => graphemes(normalizeText(text)),
  fold: (text) => stripMarks(normalizeText(text)),
  keypad: null,
});

function genericRule(script) {
  const letters = LETTERS[script] ?? null;
  return Object.freeze({
    script,
    normalize: normalizeText,
    units: graphemes,
    // `generic` (an unknown language) has no script floor.
    isOfScript: letters ? (text) => letters.test(String(text ?? '')) : () => true,
    short: (text) => graphemes(normalizeText(text)),
    fold: null,
    keypad: null,
  });
}

const RULES = Object.freeze({
  hangul: hangulRule,
  latin: latinRule,
  ...Object.fromEntries(['cyrillic', 'greek', 'han', 'kana', 'arabic', 'generic'].map((script) => [script, genericRule(script)])),
});

/** The grading rule for a script (unknown → generic). */
export function ruleFor(script) {
  return Object.hasOwn(RULES, script) ? RULES[script] : RULES.generic;
}

/** The rule for a target: its script if given, else read off the target text. */
export function ruleForTarget(target, script = null) {
  return ruleFor(script ?? scriptOfText(target));
}

/** The digit tokens of a text, in order ("Declaration (1776)" → ["1776"]). */
export function digitTokens(text) {
  return String(text ?? '').match(/\p{Nd}+/gu) ?? [];
}

/**
 * Numbers are exact in every script: the target's digit tokens must appear in
 * the answer identically (same tokens, same order). A target with no digits
 * passes this rule whatever was typed.
 */
export function numbersMatch(want, got) {
  const need = digitTokens(want);
  return need.length === 0 || need.join('|') === digitTokens(got).join('|');
}

/**
 * Copy / dictation / tiles: an exact match under the script's normalize,
 * spacing ignored (tiles join without spaces). "cat" copies "Cat" for Latin;
 * Hangul compares exactly as before.
 */
export function answersMatch(typed, target, script = null) {
  const rule = ruleForTarget(target, script);
  const key = (text) => rule.normalize(text).replace(/\s/gu, '');
  return key(typed) === key(target);
}
