// @vitest-environment node
/**
 * Direct unit coverage for `nextMove` (2026-08-14 "done rule" investigation,
 * code-review follow-up). `nextMove` had no dedicated test file before this —
 * only indirect coverage through `BuildAgenda`/`ResolveScanAction` integration
 * tests, none of which happened to exercise a bank-only, non-civilization-
 * subject unit in `issued` state. That gap is exactly how a hard-coded
 * `unit.subject !== 'civilization'` carve-out slipped into the `issued`/
 * `reprinted` case's first draft: it "worked" because every existing
 * integration test either used a `document`-based unit (never reached the
 * `unit.bank` branch at all) or a `civilization` one (the only subject the
 * carve-out allowed to print). A course belonging to any OTHER subject with a
 * bank-only lesson would have silently stopped offering reprints — the same
 * bug this file's whole investigation started from, reintroduced with
 * "subject" instead of "issuance" as the trigger.
 *
 * These tests target the fixed behavior directly: `issued`/`reprinted` always
 * routes to `print`, regardless of subject or composition, because a session
 * can only reach that state by having already passed `IssueDocument`'s own
 * printability gate once (see the long comment at the case itself). The
 * screen/print split for a unit that has NEVER printed still belongs to
 * `created`/`media_completed`, unchanged and untouched here.
 */
import { describe, it, expect } from 'vitest';
import { nextMove } from '#apps/school/usecases/offerSession.mjs';
import { reduceSession, createEvent } from '#domains/school/sessions/sessionEvents.mjs';

/** A real `reduceSession` result for a session that has issued (and optionally reprinted) once. */
function issuedState({ sessionId = 'ses_1', unitId, reprint = false } = {}) {
  const events = [];
  const created = createEvent({
    type: 'created', at: '2026-08-14T09:00:00.000Z', sessionId, learnerId: 'kid1', unitId,
  });
  expect(created.errors).toEqual([]);
  events.push({ ...created.event, seq: 1 });
  const issued = createEvent({
    type: 'issued', at: '2026-08-14T10:00:00.000Z', sessionId, artifactId: 'art_1',
  });
  expect(issued.errors).toEqual([]);
  events.push({ ...issued.event, seq: 2 });
  if (reprint) {
    const reprinted = createEvent({
      type: 'reprinted', at: '2026-08-14T11:00:00.000Z', sessionId, artifactId: 'art_1',
    });
    expect(reprinted.errors).toEqual([]);
    events.push({ ...reprinted.event, seq: 3 });
  }
  const state = reduceSession(events);
  expect(state.errors).toEqual([]);
  return state;
}

describe('nextMove: issued/reprinted always routes to a reprint', () => {
  it('a bank-only unit in a subject OTHER THAN civilization still routes to print — no subject carve-out', () => {
    // Bank-only (no `document`) is exactly the shape that used to trip the
    // hard-coded check: `unit.bank && !unit.document && unit.subject !==
    // 'civilization'` used to send this straight to `screen`.
    const unit = { unitId: 'science-checkpoint.01', subject: 'science', bank: 'science/checkpoint/01' };
    const state = issuedState({ unitId: unit.unitId });
    expect(nextMove(unit, state)).toMatchObject({ kind: 'print' });
  });

  it('a bank-only civilization unit (the atlas course shape that motivated this fix) still routes to print', () => {
    const unit = { unitId: 'atlas-us-p006-united-states', subject: 'civilization', bank: 'civilization/atlas/p006' };
    const state = issuedState({ unitId: unit.unitId });
    expect(nextMove(unit, state)).toMatchObject({ kind: 'print' });
  });

  it('a document-based unit in a non-civilization subject routes to print, unaffected by the bank/subject question', () => {
    const unit = { unitId: 'math-fractions.02', subject: 'math', document: 'math-fractions-02-worksheet' };
    const state = issuedState({ unitId: unit.unitId });
    expect(nextMove(unit, state)).toMatchObject({ kind: 'print' });
  });

  it('a second rescan (state: reprinted) still routes to print for a non-civilization bank unit', () => {
    const unit = { unitId: 'science-checkpoint.01', subject: 'science', bank: 'science/checkpoint/01' };
    const state = issuedState({ unitId: unit.unitId, reprint: true });
    expect(state.state).toBe('reprinted');
    expect(nextMove(unit, state)).toMatchObject({ kind: 'print' });
  });

  it('never falls back to "wait" for issued/reprinted — that was the original bug', () => {
    const unit = { unitId: 'anything', subject: 'skills', bank: 'skills/anything/01' };
    expect(nextMove(unit, issuedState({ unitId: unit.unitId })).kind).not.toBe('wait');
    expect(nextMove(unit, issuedState({ unitId: unit.unitId, reprint: true })).kind).not.toBe('wait');
  });
});
