/**
 * effectKinds — the preview surround's plain-language vocabulary for what the
 * filter does, shared by the rail and the timeline so a mark, its tooltip, its
 * legend swatch and its rail chip always agree.
 *
 * Four KINDS, each with one colour (preview/_palette.scss) and one shape on the
 * timeline, so they never depend on colour alone:
 *   words   — mute / bleep          — the Sound lane, a tick
 *   picture — blur / pixelate / bar — the Picture lane, a bar
 *   hidden  — blackout / title card — the Picture lane, a solid block
 *   skipped — skip / skip card      — both lanes, a hatched block
 */

export const KINDS = Object.freeze({
  words: { key: 'words', name: 'Words', legend: 'Words muted or bleeped', lane: 'sound' },
  picture: { key: 'picture', name: 'Blurred', legend: 'Picture blurred', lane: 'picture' },
  hidden: { key: 'hidden', name: 'Hidden', legend: 'Picture hidden', lane: 'picture' },
  skipped: { key: 'skipped', name: 'Skipped', legend: 'Skipped', lane: 'both' },
});
export const KIND_ORDER = ['words', 'picture', 'hidden', 'skipped'];

const KIND_OF = {
  mute: 'words', bleep: 'words',
  blur: 'picture', 'full-blur': 'picture', pixelate: 'picture', 'censor-bar': 'picture',
  blackout: 'hidden', black: 'hidden', 'title-card': 'hidden',
  skip: 'skipped', 'skip-card': 'skipped',
};
/** The kind key for an effect; unknown effects read as picture changes. */
export const kindOf = (effect) => KIND_OF[effect] || 'picture';

/** What the viewer experiences, in a sentence. */
const EFFECT_SENTENCE = {
  mute: 'Sound is muted for this word.',
  bleep: 'A bleep covers this word.',
  blur: 'The picture is blurred.',
  'full-blur': 'The whole picture is blurred.',
  pixelate: 'The picture is pixelated.',
  'censor-bar': 'A bar covers part of the picture.',
  blackout: 'The picture goes dark; the sound keeps playing.',
  black: 'The picture goes dark; the sound keeps playing.',
  'title-card': 'A title card covers the picture.',
  skip: 'The film jumps past this part.',
  'skip-card': 'The film jumps past this part and shows a title card.',
};
export const effectSentence = (effect) => EFFECT_SENTENCE[effect] || 'The filter changes this part.';

/** What was found: a word, something on screen, or a whole scene. */
export function sourceOf(cue) {
  if (cue?.scene != null) return 'Scene';
  if (kindOf(cue?.effect) === 'words' || String(cue?.category || '').startsWith('language')) return 'Word';
  return 'Visual';
}

const GROUP_NAMES = {
  language: 'Language',
  violence_blood_gore: 'Violence',
  sex_any: 'Sexual content',
  sex_nudity_immodesty: 'Nudity or immodesty',
  nudity: 'Nudity',
  alcohol_or_drug_use: 'Alcohol or drugs',
  kissing: 'Kissing',
  human_functions: 'Bodily functions',
  credits: 'Credits',
};
const words = (s) => String(s).replace(/_/g, ' ');
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A category in words: "language/profanity/damn" -> "Language: profanity",
 * "scene/sex_any" -> "Sexual content". Null when there is none.
 */
export function categoryText(category) {
  let parts = String(category || '').split('/').filter(Boolean);
  if (parts[0] === 'scene') parts = parts.slice(1);
  if (!parts.length) return null;
  const head = GROUP_NAMES[parts[0]] || capital(words(parts[0]));
  const sub = parts[1] && !/^other/.test(parts[1]) ? words(parts[1]).replace(/^language /, '') : null;
  return sub ? `${head}: ${sub}` : head;
}

/** Clock time: 75 -> "1:15", 4000 -> "1:06:40". Tenths with `precise`. */
export function clock(seconds, { precise = false } = {}) {
  if (!Number.isFinite(seconds)) return '';
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const secText = precise ? sec.toFixed(1).padStart(4, '0') : String(Math.floor(sec)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${secText}` : `${m}:${secText}`;
}

/** "0.3 s", "12 s", "1 min 5 s". */
export function lengthText(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 10) return `${Math.round(seconds * 10) / 10} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m} min ${s} s` : `${m} min`;
}

/** How far ahead, for a rail row: "in 42 s" under a minute, else "in 1:12". */
export function awayText(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `in ${s} s` : `in ${clock(s)}`;
}

/** Certification, in words a parent can act on. */
export function certificationText(level) {
  if (level === 'parent') return { tone: 'good', line: 'Signed off by a grown-up.' };
  if (level === 'machine') {
    return { tone: 'good', line: 'Checked by machine. Every flagged word is covered: most to the millisecond, the rest with a safe margin around them.' };
  }
  return { tone: 'caution', line: 'Not checked yet. Some timings are rough, so a word could slip through.' };
}

const EFFECT_WORD = {
  mute: 'muted', bleep: 'bleeped',
  blur: 'blurred', 'full-blur': 'blurred', pixelate: 'pixelated', 'censor-bar': 'covered',
  blackout: 'hidden', black: 'hidden', 'title-card': 'title card',
  skip: 'skipped', 'skip-card': 'skipped',
};
/** The effect in one lower-case word: "muted", "hidden", "skipped". */
export const effectWord = (e) => EFFECT_WORD[e] || e || '';
/** The same word for a chip: "Muted", "Hidden". */
export const effectChip = (e) => { const w = effectWord(e); return w ? w.charAt(0).toUpperCase() + w.slice(1) : ''; };
/** A row's label; scene pieces carry none, so fall back to "Scene" + effect word. */
export const rowLabel = (item) => item?.label || `Scene ${effectWord(item?.effect)}`.trim();
