import { describe, it, expect } from 'vitest';
import { GetLearnerRecord } from './GetLearnerRecord.mjs';

const silent = { warn() {} };

describe('GetLearnerRecord (admin advocacy #14 — one merged record per child)', () => {
  it('merges six channels newest-first, each row tagged with its source', async () => {
    const uc = new GetLearnerRecord({
      teacherNotes: { list: () => [{ at: '2026-08-03T10:00:00Z', from: 'kckern', note: 'Nice work' }] },
      reviewQueue: { listForLearner: async () => [{ gradedAt: '2026-08-05T10:00:00Z', itemId: 'q1', verdict: 'correct', gradedBy: 'kckern' }] },
      attestations: { list: () => [{ at: '2026-08-01T10:00:00Z', unitId: 'u1', attestedBy: 'kckern', reason: 'omr down' }] },
      enrichment: { list: () => [{ from: '2026-08-02', title: 'Zion trip', recordedBy: 'kckern' }] },
      quizRequests: () => [
        { at: '2026-08-04T10:00:00Z', userId: 'learner4', kind: 'flag', bankId: 'caps', note: 'looks wrong' },
        { at: '2026-08-04T11:00:00Z', userId: 'learner3', unitId: 'x' }, // other kid, excluded
      ],
      printRequests: (id) => (id === 'learner4' ? [{ at: '2026-08-06T10:00:00Z', label: 'Maze', status: 'denied', deniedBy: 'kckern' }] : []),
      logger: silent,
    });
    const { entries } = await uc.execute({ learnerId: 'learner4' });
    expect(entries.map((e) => e.channel)).toEqual(['print', 'review', 'flag', 'note', 'enrichment', 'attestation']);
    expect(entries.find((e) => e.channel === 'flag')).toMatchObject({ note: 'looks wrong' });
  });

  it('every store optional; a throwing store degrades to absent, never a crash', async () => {
    const uc = new GetLearnerRecord({
      teacherNotes: { list: () => { throw new Error('corrupt'); } },
      logger: silent,
    });
    await expect(uc.execute({ learnerId: 'learner4' })).resolves.toEqual({ learnerId: 'learner4', entries: [] });
  });
});
