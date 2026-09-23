/**
 * The practice menu's runs (spec §6 practice menu). Only `quiz` grades (rule 1);
 * everything else is study. Pure.
 */
import { hashString, seededShuffle } from './checkItem.mjs';
import { drillSteps, matchBoard } from './drill.mjs';
import { isUnsettled } from './mastery.mjs';

export const PRACTICE_MODES = Object.freeze(['flashcards', 'match', 'say', 'write', 'listen', 'drill', 'quiz']);

export function practiceWordIds({ filter = 'introduced', words = {}, chosen = [] }) {
  const all = Object.entries(words);
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
    for (let i = 0; i < ids.length; i += 6) {
      const slice = ids.slice(i, i + 6).map((id) => entries.get(id));
      if (slice.length >= 2) queue.push({ kind: 'match', board: matchBoard(slice, media, `${seed}|${i}`) });
    }
  } else if (mode === 'say') queue = capabilities.microphone === true ? ids.map((wordId) => ({ kind: help ? 'say-after' : 'say-from-cue', wordId })) : [];
  else if (mode === 'write') queue = ids.map((wordId) => ({ kind: help ? 'copy' : 'type-practice', wordId }));
  else if (mode === 'listen') { const heard = ids.filter((id) => media[id]?.audio); queue = heard.length ? [{ kind: 'listen', wordIds: heard }] : []; }
  else if (mode === 'drill') queue = ids.map((wordId) => ({ kind: 'drill', wordId, steps: drillSteps(media[wordId], capabilities) }));
  else if (mode === 'quiz') {
    const eligible = ids.filter((id) => words[id].state !== 'mastered' && words[id].verifyFailedDay !== day);
    queue = [...eligible.map((wordId) => ({ kind: 'graded', task: '3.3', wordId })), ...eligible.map((wordId) => ({ kind: 'graded', task: '2.2', wordId }))];
  }
  return { mode, help, queue, index: 0, step: 0, passed: [], failed: [] };
}
