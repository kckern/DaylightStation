import { createCoachPlan } from '../../shared/music/learnCoach.mjs';

export function pianoCoachFixture() {
  const plan = createCoachPlan({ scoreId: 'files:test.musicxml', fingerprint: 'content-a',
    segments: [{ id: 'opening', inMeasure: 0, outMeasure: 3, printedMeasures: [1, 4], playableParts: ['rh', 'lh'] }], tempoMap: [{ onsetQuarter: 0, bpm: 100 }] });
  const records = new Map(); const receipts = new Map(); const pending = new Map(); const attempts = new Map();
  let failure = false;
  const key = (user, score) => `${user}/${score}`;
  const datastore = {
    getPractice: (user, score) => ['learner4', 'learner5'].includes(user) ? structuredClone(records.get(key(user, score)) ?? {}) : null,
    savePractice: (user, score, state) => { if (failure) { failure = false; throw new Error('disk full'); } records.set(key(user, score), structuredClone(state)); },
    isKnownUser: (user) => ['learner4', 'learner5'].includes(user),
  };
  const receiptStore = {
    loadPending: (u, s) => structuredClone(pending.get(key(u, s)) ?? null),
    savePending: (u, s, value) => pending.set(key(u, s), structuredClone(value)),
    clearPending: (u, s) => pending.delete(key(u, s)),
    getReceipt: (u, s, id) => structuredClone(receipts.get(`${key(u, s)}/${id}`) ?? null),
    saveReceipt: (u, s, id, value) => receipts.set(`${key(u, s)}/${id}`, structuredClone(value)),
  };
  const attemptStore = { get: (user, id) => {
    const record = attempts.get(id);
    return record?.user_id === user ? structuredClone(record) : null;
  } };
  const result = { status: 'completed', inputContractVersion: 'onsets-v1', score: 1,
    criteria: { completeness: 1, cleanliness: 1, placement: 1 }, verdict: { passed: true },
    diagnostics: { expected_notes: 10, matched_notes: 10, wrong_notes: 0, missed_notes: 0 } };
  const outcome = (id, over = {}) => {
    const task = over.task ?? plan.tasks[0];
    const record = { ...result, ...over.result, attempt_id: id, user_id: 'learner4', purpose: 'practice',
      provider_version: 'exercise-runtime-v5-onsets', prompt: { exercise_id: plan.scoreId },
      context: { inputContractVersion: 'onsets-v1', learnCoachTask: task } };
    attempts.set(id, record);
    return { plan, event: { id, type: 'outcome', profileId: 'learner4', task, result: { ...result, ...over.result }, ...over.event } };
  };
  return { plan, records, datastore, receiptStore, receipts, pending, attempts, attemptStore, outcome,
    failNextSave: () => { failure = true; }, clock: () => new Date('2026-10-26T18:00:00Z'), timezone: 'America/Los_Angeles', logger: { info() {}, warn() {}, error() {} } };
}
