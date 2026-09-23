/**
 * The practice menu's runs (spec §6 practice menu). Only `quiz` grades (rule 1);
 * everything else is study. Pure.
 */
import { hashString, seededShuffle } from './checkItem.mjs';
import { drillSteps, matchBoard } from './drill.mjs';
import { isExcluded, isUnsettled, readyForSignOff } from './mastery.mjs';

const QUIZZABLE = new Set(['familiar', 'claimed']);

/**
 * The verify quiz, a round's or a practice Quiz me: recognition only (ruling
 * 2026-09-23 — typing from memory is the final sign-off, never up front).
 * 3.1 English → pick the Korean first, then 2.2 pick the meaning (hear
 * channel when there is term audio). First-miss stop drops the rest.
 */
export const VERIFY_TASKS = Object.freeze(['3.1', '2.2']);

export const PRACTICE_MODES = Object.freeze(['flashcards', 'match', 'say', 'write', 'listen', 'drill', 'quiz']);

/**
 * Match boards of 4-6 pairs (spec §3, 2.3): never below 4, never above 6, split
 * as evenly as possible. n<4 makes no board at all. For n=7 there is no
 * partition where every part is 4-6 (4+4=8 too many, one board of 7 too big),
 * so the even split lands one board a pair short — the only input in normal
 * range where the two bounds can't both hold.
 */
function boardSizes(n) {
  if (n < 4) return [];
  const k = Math.ceil(n / 6);
  const base = Math.floor(n / k);
  const remainder = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function practiceWordIds({ filter = 'introduced', words = {}, chosen = [] }) {
  const all = Object.entries(words).filter(([, w]) => !isExcluded(w));
  if (filter === 'working') return all.filter(([, w]) => isUnsettled(w)).map(([id]) => id);
  if (filter === 'tricky') return all.filter(([, w]) => w.tricky).map(([id]) => id);
  const introduced = all.filter(([, w]) => w.state !== 'new').map(([id]) => id);
  if (filter === 'chosen') return chosen.filter((id) => introduced.includes(id));
  return introduced;
}

export function buildPractice({ mode, help = true, filter = 'introduced', chosen = [], words, entries, media, day, seed, capabilities = {}, frontSide = 'term' }) {
  const ids = seededShuffle(practiceWordIds({ filter, words, chosen }).filter((id) => entries.has(id)), hashString(`${seed}|practice`));
  let queue = [];
  if (mode === 'flashcards') queue = ids.map((wordId) => ({ kind: 'flashcard', wordId, front: frontSide }));
  else if (mode === 'match') {
    let offset = 0;
    for (const size of boardSizes(ids.length)) {
      const slice = ids.slice(offset, offset + size).map((id) => entries.get(id));
      queue.push({ kind: 'match', board: matchBoard(slice, media, `${seed}|${offset}`) });
      offset += size;
    }
  } else if (mode === 'say') {
    // 1.2 say-after (help) models the term, so it needs term audio to say after;
    // 3.4 say-from-cue (no help) has no model to begin with — the native
    // comparison at the end is simply skipped when there's no audio.
    if (capabilities.microphone !== true) queue = [];
    else if (help) queue = ids.filter((id) => media[id]?.audio === true).map((wordId) => ({ kind: 'say-after', wordId }));
    else queue = ids.map((wordId) => ({ kind: 'say-from-cue', wordId }));
  }
  // write help = 1.1 copy-type (see text, type it); no help = 3.3 type-from-cue
  // (cue only, no reference to copy) — neither needs audio. Typing from memory
  // only over words ready for their typed sign-off (ruling 2026-09-23).
  else if (mode === 'write') {
    queue = help ? ids.map((wordId) => ({ kind: 'copy', wordId }))
      : ids.filter((id) => readyForSignOff(words[id])).map((wordId) => ({ kind: 'type-practice', wordId }));
  }
  else if (mode === 'listen') { const heard = ids.filter((id) => media[id]?.audio); queue = heard.length ? [{ kind: 'listen', wordIds: heard }] : []; }
  else if (mode === 'drill') queue = ids.map((wordId) => ({ kind: 'drill', wordId, steps: drillSteps(media[wordId], capabilities, { ready: readyForSignOff(words[wordId]) }) }));
  else if (mode === 'quiz') {
    // Same rule as a round's verify (spec §4 Round end, rule 3): familiar or
    // claimed, or notYetCarry — never new / introduced / notYet — and not
    // failed today. Recognition only, like verify (ruling 2026-09-23).
    const eligible = ids.filter((id) => (QUIZZABLE.has(words[id].state) || words[id].notYetCarry === true) && words[id].verifyFailedDay !== day);
    queue = VERIFY_TASKS.flatMap((task) => eligible.map((wordId) => ({ kind: 'graded', task, wordId })));
  }
  return { mode, help, queue, index: 0, step: 0, passed: [], failed: [] };
}
