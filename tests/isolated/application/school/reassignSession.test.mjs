/**
 * THE EVENT NOTHING COULD WRITE.
 *
 * `reassigned` shipped fully declared — schema, validator, reducer handler, a
 * place in `ANNOTATION_EVENTS` — and no writer. Attribution repair moved
 * ATTEMPT events instead, so a lesson with no machine attempts (program-served,
 * paper marked by hand, a launch outcome) could not be given back to the child
 * who actually did it by any means the household had.
 *
 * `ReassignSession` is that writer. These tests pin the four things the repair
 * has to hold to: the work moves, a same-learner move is refused, a reasonless
 * move is refused, and both children are told.
 */
import { describe, it, expect, vi } from 'vitest';
import { ReassignSession } from '#apps/school/usecases/ReassignSession.mjs';
import { FakeSessionRepository } from '../../../_lib/school/lifecycleFakes.mjs';

const NOW = new Date('2026-08-26T18:00:00.000Z');
const AT = '2026-08-26T09:00:00.000Z';
const REASON = 'Learner Three sat down at Learner Four’s station';

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const passingGate = () => ({ assert: vi.fn() });
const refusingGate = () => ({
  assert: vi.fn(() => {
    const err = new Error('Only a listed teacher can do this.');
    err.name = 'GuestForbiddenError';
    throw err;
  }),
});
const noteStore = () => ({ entries: [], append: vi.fn(async function a(e) { this.entries.push(e); }) });

/** A program-served lesson: dispatched, outcome recorded, coins paid. No attempts anywhere. */
const SETTLED = [
  { type: 'created', at: AT, learnerId: 'learner4', unitId: 'korean.day-12', studyDay: '2026-08-26' },
  { type: 'program_dispatched', at: AT, programId: 'language', corpusId: 'glossika-korean', day: 12 },
  { type: 'outcome_recorded', at: AT, outcomeId: 'out:ses_1', result: 'passed' },
  { type: 'rewarded', at: AT, txnId: 'txn_1', amount: 5 },
];

async function build({ events = SETTLED, gate = passingGate(), notes = null, auditLog = null } = {}) {
  const sessions = new FakeSessionRepository();
  for (const event of events) {
    // eslint-disable-next-line no-await-in-loop
    await sessions.appendEvent('ses_1', event);
  }
  const useCase = new ReassignSession({
    sessions, teacherGate: gate, notes, auditLog, clock: () => NOW, logger: silent,
  });
  return { sessions, useCase };
}

const move = (useCase, over = {}) => useCase.execute({
  sessionId: 'ses_1', toLearnerId: 'learner3', reason: REASON, reassignedBy: 'kckern', pin: '7410', ...over,
});

describe('ReassignSession', () => {
  it('re-credits a settled lesson with no machine attempts, without moving its lifecycle', async () => {
    const { sessions, useCase } = await build();
    const result = await move(useCase);

    expect(result).toMatchObject({
      sessionId: 'ses_1', fromLearnerId: 'learner4', toLearnerId: 'learner3',
      day: '2026-08-26', unitId: 'korean.day-12',
    });
    // The derived record, not the call: the work now reads as learner3's, the
    // session is still settled at `rewarded`, and nothing was edited.
    const state = sessions.derive('ses_1');
    expect(state.errors).toEqual([]);
    expect(state.learnerId).toBe('learner3');
    expect(state.state).toBe('rewarded');
    expect(state.terminal).toBe(true);
    expect(await sessions.listForLearner('learner4')).toEqual([]);
    expect((await sessions.listForLearner('learner3')).map((r) => r.sessionId)).toEqual(['ses_1']);

    // Append-only, and the why travels with the work.
    expect(sessions.types('ses_1')).toEqual([
      'created', 'program_dispatched', 'outcome_recorded', 'rewarded', 'reassigned',
    ]);
    expect(sessions.events('ses_1').at(-1)).toMatchObject({
      type: 'reassigned', fromLearnerId: 'learner4', toLearnerId: 'learner3',
      reviewedBy: 'kckern', reason: REASON, at: NOW.toISOString(),
    });
  });

  it('refuses a move to the learner who already has it, and writes nothing', async () => {
    const { sessions, useCase } = await build();
    await expect(move(useCase, { toLearnerId: 'learner4' })).rejects.toThrow(/must differ from fromLearnerId/);
    expect(sessions.types('ses_1')).not.toContain('reassigned');
  });

  it('refuses a move with no reason, and writes nothing', async () => {
    const { sessions, useCase } = await build();
    await expect(move(useCase, { reason: '   ' })).rejects.toThrow(/reason/);
    await expect(move(useCase, { reason: undefined })).rejects.toThrow(/reason/);
    expect(sessions.types('ses_1')).not.toContain('reassigned');
  });

  it('refuses anyone the teacher gate refuses, before reading the log', async () => {
    const gate = refusingGate();
    const { sessions, useCase } = await build({ gate });
    await expect(move(useCase)).rejects.toThrow(/Only a listed teacher/);
    expect(gate.assert).toHaveBeenCalledWith(expect.objectContaining({ action: 'sessions.reassign' }));
    expect(sessions.types('ses_1')).not.toContain('reassigned');
  });

  it('refuses a session that does not exist', async () => {
    const { useCase } = await build();
    await expect(useCase.execute({
      sessionId: 'ses_ghost', toLearnerId: 'learner3', reason: REASON, reassignedBy: 'kckern',
    })).rejects.toThrow(/ses_ghost/);
  });

  it('tells BOTH children, and a broken notes store never blocks the move', async () => {
    const notes = noteStore();
    const { sessions, useCase } = await build({ notes });
    await move(useCase);
    // Sorted: this asserts WHICH TWO children were told, not the order.
    expect(notes.entries.map((n) => n.learnerId).sort()).toEqual(['learner3', 'learner4']);
    expect(notes.entries.every((n) => n.from === 'kckern' && n.note.includes('2026-08-26'))).toBe(true);
    expect(sessions.derive('ses_1').learnerId).toBe('learner3');

    const broken = { append: vi.fn(async () => { throw new Error('offline'); }) };
    const second = await build({ notes: broken });
    await expect(move(second.useCase)).resolves.toMatchObject({ toLearnerId: 'learner3' });
    expect(second.sessions.derive('ses_1').learnerId).toBe('learner3');
  });

  it('records its own audit-trail entry, marked as a session move, best-effort', async () => {
    const auditLog = { append: vi.fn(async () => {}) };
    const { useCase } = await build({ auditLog });
    await move(useCase);
    expect(auditLog.append).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'session', sessionId: 'ses_1', assessmentId: 'ses_1', moved: 1,
      fromLearnerId: 'learner4', toLearnerId: 'learner3', day: '2026-08-26',
      reason: REASON, reassignedBy: 'kckern', at: NOW.toISOString(),
    }));

    const throwing = { append: vi.fn(async () => { throw new Error('disk full'); }) };
    const second = await build({ auditLog: throwing });
    await expect(move(second.useCase)).resolves.toMatchObject({ toLearnerId: 'learner3' });
    expect(second.sessions.derive('ses_1').learnerId).toBe('learner3');
  });
});
