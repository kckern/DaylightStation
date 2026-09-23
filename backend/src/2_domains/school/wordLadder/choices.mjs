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

export function cueFor(entry, media = {}, seed) {
  const kinds = [...(media.image ? ['image'] : []), 'text', ...(media.glossAudio ? ['audio'] : [])];
  const kind = kinds[hashString(`${seed}|cue`) % kinds.length];
  return kind === 'text' ? { type: 'text', text: entry.gloss } : { type: kind };
}

export function channelFor(media = {}) {
  return media.audio ? 'hear' : 'read';
}
