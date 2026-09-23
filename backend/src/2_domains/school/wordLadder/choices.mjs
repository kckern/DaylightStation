/**
 * Graded options and cues (spec §2 Choices). Pictures are cues only — every
 * graded option is text. Pick-term decoys are words the learner already met,
 * so the child must know WHICH known word it is, not spot the only familiar one.
 */
import { hashString, seededShuffle } from './checkItem.mjs';

const fold = (value) => String(value).trim().toLocaleLowerCase();

function assemble(answer, decoys, seed) {
  const unique = [];
  for (const decoy of decoys) {
    if (fold(decoy) !== fold(answer) && !unique.some((u) => fold(u) === fold(decoy))) unique.push(decoy);
  }
  const picked = unique.slice(0, 3);
  return { answer, choices: seededShuffle([answer, ...picked], hashString(`${seed}|choices`)) };
}

export function pickMeaningChoices(entry, seed) {
  const decoys = seededShuffle(entry.decoys?.gloss ?? [], hashString(`${seed}|gloss`));
  return assemble(entry.gloss, decoys, seed);
}

export function pickTermChoices(entry, introducedSameKind = [], seed) {
  const known = seededShuffle(
    introducedSameKind.filter((other) => other.id !== entry.id && other.kind === entry.kind).map((other) => other.term),
    hashString(`${seed}|known`),
  );
  const authored = seededShuffle(entry.decoys?.term ?? [], hashString(`${seed}|term`));
  return assemble(entry.term, [...known, ...authored], seed);
}

/**
 * The English-side cue for a recall task (3.1 pick-term, 3.3 type-from-cue,
 * the drill's tiles / say-from-cue / type): ONE bundle — the gloss as text,
 * plus whether a picture and a gloss clip exist to show and play with it.
 *
 * Ruling 2026-09-23 (owner): English-side cues show text + picture + audio
 * together; the prompt is never the test. This replaced a seeded pick of one
 * kind (image | text | audio), which could leave a child with nothing on
 * screen but an English sound. Pure and deterministic; `seed` is accepted for
 * the callers' signature and deliberately ignored.
 */
// eslint-disable-next-line no-unused-vars
export function cueFor(entry, media = {}, seed) {
  return { type: 'english', text: entry.gloss, image: Boolean(media.image), audio: Boolean(media.glossAudio) };
}

export function channelFor(media = {}) {
  return media.audio ? 'hear' : 'read';
}
