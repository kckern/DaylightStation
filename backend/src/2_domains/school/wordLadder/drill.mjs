/**
 * The drill (spec §3 drill path): one word walked from full support to none.
 * Nothing here grades. Steps that need a mic or term audio are dropped, never
 * blocked on.
 */
import { hashString, seededShuffle } from './checkItem.mjs';

export const DRILL_STEPS = Object.freeze(['look', 'copy', 'say-after', 'match', 'read-aloud', 'dictation', 'tiles', 'say-from-cue', 'type']);
const NEEDS_MIC = new Set(['say-after', 'read-aloud', 'say-from-cue']);
const NEEDS_AUDIO = new Set(['say-after', 'dictation']);

export function drillSteps(media = {}, capabilities = {}) {
  return DRILL_STEPS.filter((step) => (capabilities.microphone === true || !NEEDS_MIC.has(step))
    && (media.audio === true || !NEEDS_AUDIO.has(step)));
}

const syllables = (text) => [...String(text).normalize('NFC')].filter((ch) => /[가-힣]/u.test(ch));

export function tilesFor(entry, deckTerms = [], seed) {
  const answer = syllables(entry.term);
  const pool = [...new Set(deckTerms.flatMap(syllables))].filter((s) => !answer.includes(s));
  const decoys = seededShuffle(pool, hashString(`${seed}|tile-decoys`)).slice(0, 2);
  return seededShuffle([...answer, ...decoys], hashString(`${seed}|tiles`));
}

export function matchBoard(entries, media = {}, seed) {
  const chosen = seededShuffle(entries, hashString(`${seed}|board`)).slice(0, 6);
  const pictures = chosen.length > 0 && chosen.every((entry) => media[entry.id]?.image === true);
  return {
    pairs: chosen.map((entry) => ({
      wordId: entry.id, term: entry.term,
      right: pictures ? { type: 'image' } : { type: 'text', text: entry.gloss },
    })),
  };
}
