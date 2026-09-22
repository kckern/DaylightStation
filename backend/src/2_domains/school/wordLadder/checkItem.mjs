/**
 * One multiple-choice check (design "Daily session" step 1). Pure and
 * deterministic from word + study day, so a reload shows the same check and
 * the server can re-derive the answer it grades against.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * `term` is the word in the language being learned, `gloss` its meaning in
 * the learner's language. Picture and audio prompts ask for the term; a text
 * prompt shows the term and asks for its gloss.
 */
export const CHECK_DIRECTIONS = Object.freeze(['picture_to_term', 'audio_to_term', 'term_to_gloss']);

/** FNV-1a, 32 bit. */
export function hashString(value) {
  let hash = 0x811c9dc5;
  for (const ch of String(value)) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(items, seed) {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function checkDirection(wordId, day) {
  return CHECK_DIRECTIONS[hashString(`${wordId}|${day}`) % CHECK_DIRECTIONS.length];
}

/** A direction that needs media the word does not have falls back to term→gloss. */
export function resolveDirection(wordId, day, media = {}) {
  const direction = checkDirection(wordId, day);
  if (direction === 'picture_to_term' && media?.image !== true) return 'term_to_gloss';
  if (direction === 'audio_to_term' && media?.audio !== true) return 'term_to_gloss';
  return direction;
}

export function answerFor(entry, direction) {
  return direction === 'term_to_gloss' ? entry.gloss : entry.term;
}

export function buildChoices(entry, direction, day) {
  if (!CHECK_DIRECTIONS.includes(direction)) throw new ValidationError(`unknown check direction '${direction}'`);
  const answer = answerFor(entry, direction);
  const fold = (value) => value.trim().toLocaleLowerCase();
  const pool = (direction === 'term_to_gloss' ? entry.decoys.gloss : entry.decoys.term)
    .filter((decoy) => fold(decoy) !== fold(answer));
  const decoys = seededShuffle(pool, hashString(`${entry.id}|${day}|decoys`)).slice(0, 3);
  const choices = seededShuffle([answer, ...decoys], hashString(`${entry.id}|${day}|${direction}`));
  return { answer, choices };
}
