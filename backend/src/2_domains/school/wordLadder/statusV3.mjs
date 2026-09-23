/** Status v3 + per-day file shapes, and the one-way v2 → v3 migration (spec §4 Storage). Pure. */
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import { emptyWordV3 } from './mastery.mjs';

export const STATUS_SCHEMA_V3 = 'school.word-ladder-status/v3';
export const DAY_SCHEMA = 'school.word-ladder-day/v1';
const V2_SCHEMA = 'school.word-ladder-status/v1';

export function emptyStatusV3() {
  return { schema: STATUS_SCHEMA_V3, words: {}, decksSeen: [], lastFoldedDay: null, paperAttemptsFolded: [] };
}

export function emptyDay(day) {
  return {
    schema: DAY_SCHEMA, day, atOpen: null, rechecks: { order: [], answered: {} }, rounds: [],
    activeMs: 0, lastInputAt: null, items: {}, sittings: {}, doneAt: null,
    drills: [], practice: null, practiceRuns: 0, summarySeen: false, capabilities: { microphone: false },
  };
}

function migrateWord(old) {
  const w = emptyWordV3();
  if (old?.state === 'learning') return { ...w, state: 'familiar' };
  if (old?.state === 'claimed') return { ...w, state: 'claimed' };
  if (old?.state === 'known') {
    return { ...w, state: 'mastered', stage: (old.step ?? 0) + 1, dueDay: old.nextCheckDay ?? null };
  }
  return w;
}

export function migrateStatusV2(raw) {
  if (raw?.schema !== V2_SCHEMA) throw new DomainInvariantError(`cannot migrate word-ladder status schema '${raw?.schema}'`);
  const words = Object.fromEntries(Object.entries(raw.words ?? {}).map(([id, word]) => [id, migrateWord(word)]));
  return {
    ...emptyStatusV3(),
    words,
    lastFoldedDay: raw.lastFoldedDay ?? null,
    paperAttemptsFolded: Array.isArray(raw.paperAttemptsFolded) ? [...raw.paperAttemptsFolded] : [],
  };
}
