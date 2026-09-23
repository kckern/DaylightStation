/** Status v3 + per-day file shapes, and the one-way v2 → v3 migration (spec §4 Storage). Pure. */
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import { emptyWordV3 } from './mastery.mjs';

export const STATUS_SCHEMA_V3 = 'school.card-ladder-status/v3';
export const DAY_SCHEMA = 'school.card-ladder-day/v1';
// The engine was the word ladder until 2026-09-23. Files written before then
// carry these names; they are read as the current schemas and written back
// under the current ones. The v1 status only ever existed under its old name.
export const LEGACY_STATUS_SCHEMA_V3 = 'school.word-ladder-status/v3';
export const LEGACY_DAY_SCHEMA = 'school.word-ladder-day/v1';
const V2_SCHEMA = 'school.word-ladder-status/v1';

/** A v3 status schema under either name. */
export function isStatusV3Schema(schema) {
  return schema === STATUS_SCHEMA_V3 || schema === LEGACY_STATUS_SCHEMA_V3;
}
/** A day-file schema under either name. */
export function isDaySchema(schema) {
  return schema === DAY_SCHEMA || schema === LEGACY_DAY_SCHEMA;
}

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
    return { ...w, ...GRANDFATHERED, state: 'mastered', stage: (old.step ?? 0) + 1, dueDay: old.nextCheckDay ?? null };
  }
  return w;
}

// Ruling 2026-09-23: a word mastered before the sign-off flags existed already
// passed the old ladder's quizzes, so it is not walled behind a Match it
// never had. It is not signed off unless a typed pass is on record.
const GRANDFATHERED = Object.freeze({ recognizedCount: 2, matched: true, typedSignedOff: null });

function withFlags(word) {
  if (!word || typeof word !== 'object' || Object.hasOwn(word, 'recognizedCount')) return word;
  const typedPass = word.lastGraded?.correct === true && word.lastGraded?.task === '3.3' ? word.lastGraded.day ?? null : null;
  if (word.state === 'mastered') return { ...word, ...GRANDFATHERED, typedSignedOff: word.typedSignedOff ?? typedPass };
  return { ...word, recognizedCount: 0, matched: word.matched === true, typedSignedOff: word.typedSignedOff ?? null };
}

/**
 * A v3 status as read (pure, on read, like the v1 migration): words written
 * before the sign-off flags get them — at their defaults, or grandfathered
 * when already mastered. A word that already carries them is left alone.
 */
export function normalizeStatusV3(raw) {
  const words = Object.fromEntries(Object.entries(raw?.words ?? {}).map(([id, word]) => [id, withFlags(word)]));
  return { ...emptyStatusV3(), ...raw, schema: STATUS_SCHEMA_V3, words };
}

export function migrateStatusV2(raw) {
  if (raw?.schema !== V2_SCHEMA) throw new DomainInvariantError(`cannot migrate card-ladder status schema '${raw?.schema}'`);
  const words = Object.fromEntries(Object.entries(raw.words ?? {}).map(([id, word]) => [id, migrateWord(word)]));
  return {
    ...emptyStatusV3(),
    words,
    lastFoldedDay: raw.lastFoldedDay ?? null,
    paperAttemptsFolded: Array.isArray(raw.paperAttemptsFolded) ? [...raw.paperAttemptsFolded] : [],
  };
}
