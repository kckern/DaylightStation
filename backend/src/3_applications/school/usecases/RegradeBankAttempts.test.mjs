import { describe, it, expect, vi } from 'vitest';
import { RegradeBankAttempts } from './RegradeBankAttempts.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';

const silent = { info() {}, warn() {}, error() {} };
const BANK = {
  id: 'caps',
  title: 'Caps',
  items: [{ id: 'q1', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] }],
};

const ATTEMPTS = {
  learner4: [
    // Graded WRONG under the buggy key (answer used to be 'Seattle'): child
    // chose Olympia, recorded incorrect. Current key says correct.
    { id: 'att_1', at: '2026-08-01T10:00:00.000Z', sessionId: 'ses_1', bankId: 'caps', itemId: 'q1', given: 'Olympia', correct: false },
    { id: 'att_2', at: '2026-08-01T10:01:00.000Z', sessionId: 'ses_1', bankId: 'caps', itemId: 'q1', given: 'Seattle', correct: false }, // still wrong — unchanged
    { id: 'att_3', at: '2026-08-01T10:02:00.000Z', sessionId: 'ses_2', bankId: 'other', itemId: 'q1', given: 'Olympia', correct: false }, // other bank
    { id: 'att_4', at: '2026-08-01T10:03:00.000Z', sessionId: 'ses_3', bankId: 'caps', itemId: 'q1', given: null, correct: true }, // self-graded
  ],
};

const make = ({ appended = [], sessions = null, worksheetInstances = null, sessionCorrection = null } = {}) => new RegradeBankAttempts({
  datastore: {
    // The fake honors the ranged read INCLUDING appended corrections, so the
    // idempotency scan-to-today sees them like the real store would.
    readAttemptsInRange: (learnerId, fromDay, toDay) => [
      ...(ATTEMPTS[learnerId] ?? []),
      ...appended.filter((r) => r.learnerId === learnerId).map((r) => r.attempt),
    ].filter((a) => {
      const day = String(a.at).slice(0, 10);
      return day >= fromDay && day <= toDay;
    }),
    appendAttempt: vi.fn((learnerId, attempt) => { appended.push({ learnerId, attempt }); return attempt; }),
    readAllAttempts: (learnerId) => [...(ATTEMPTS[learnerId] ?? []),
      ...appended.filter((r) => r.learnerId === learnerId).map((r) => r.attempt)],
  },
  bankReader: { getBank: (id) => (id === 'caps' ? BANK : null) },
  teacherGate: { assert: ({ userId }) => { if (userId !== 'kckern') throw new GuestForbiddenError('no'); } },
  learnerDirectory: { listLearners: async () => [{ id: 'learner4' }] },
  sessions, worksheetInstances, sessionCorrection,
  clock: () => new Date('2026-08-20T12:00:00.000Z'),
  logger: silent,
});

describe('RegradeBankAttempts (admin advocacy #5)', () => {
  it('dry run names every verdict change and affected session, writes nothing', async () => {
    const appended = [];
    const uc = make({ appended });
    const r = await uc.execute({ bankId: 'caps', fromDay: '2026-08-01', toDay: '2026-08-02', reason: 'answer key fixed', regradedBy: 'kckern' });
    expect(r).toMatchObject({ applied: false, checked: 2 });
    expect(r.changed).toEqual([{ learnerId: 'learner4', attemptId: 'att_1', sessionId: 'ses_1', itemId: 'q1', was: false, now: true }]);
    expect(r.sessionsAffected).toEqual(['ses_1']);
    expect(appended).toEqual([]);
  });

  it('defaults the through-day to the operation day when the CLI omits it', async () => {
    const r = await make().execute({
      bankId: 'caps', fromDay: '2026-08-01', reason: 'answer key fixed', regradedBy: 'kckern',
    });
    expect(r).toMatchObject({ fromDay: '2026-08-01', toDay: '2026-08-20', checked: 2 });
  });

  it('--apply appends a corrective attempt with full provenance, never editing the original', async () => {
    const appended = [];
    const uc = make({ appended });
    await uc.execute({ bankId: 'caps', fromDay: '2026-08-01', toDay: '2026-08-02', reason: 'answer key fixed', regradedBy: 'kckern', apply: true });
    expect(appended).toHaveLength(1);
    expect(appended[0].attempt).toMatchObject({
      id: 'att_rg_att_1', correct: true, itemId: 'q1',
      provenance: { kind: 'regrade', of: 'att_1', by: 'kckern', reason: 'answer key fixed' },
    });
    expect(appended[0].attempt.bankRev).toMatch(/^[0-9a-f]{12}$/);
  });

  it('re-running --apply is IDEMPOTENT — prior corrections are found forward-of-window and skipped (M8 fix 3)', async () => {
    const appended = [];
    const uc = make({ appended });
    const args = { bankId: 'caps', fromDay: '2026-08-01', toDay: '2026-08-02', reason: 'answer key fixed', regradedBy: 'kckern', apply: true };
    await uc.execute(args);
    expect(appended).toHaveLength(1);
    const second = await uc.execute(args); // the corrective row's at (2026-08-20) is OUTSIDE the scanned window
    expect(second.changed).toEqual([]);
    expect(second.alreadyCorrected).toBe(1);
    expect(appended).toHaveLength(1); // nothing re-appended
  });

  it('turns a fully evidenced applied regrade into one append-only session correction', async () => {
    const appended = [];
    const sessionCorrection = vi.fn(async (args) => ({ ...args, idempotent: false,
      receiptArtifact: { artifactId: `receipt/ses_1/correction/${args.adjustmentId}` } }));
    const sessions = { readEvents: async () => [
      { type: 'created', at: '2026-08-01T10:00:00.000Z', sessionId: 'ses_1', seq: 1, learnerId: 'learner4', unitId: 'unit_1' },
      { type: 'issued', at: '2026-08-01T10:01:00.000Z', sessionId: 'ses_1', seq: 2, artifactId: 'art_1' },
      { type: 'submitted', at: '2026-08-01T10:02:00.000Z', sessionId: 'ses_1', seq: 3, transport: 'paper' },
      { type: 'graded', at: '2026-08-01T10:03:00.000Z', sessionId: 'ses_1', seq: 4,
        attemptIds: ['att_1', 'att_2'], percent: 0, correctCount: 0, totalCount: 2 },
      { type: 'outcome_recorded', at: '2026-08-01T10:04:00.000Z', sessionId: 'ses_1', seq: 5,
        outcomeId: 'out_1', result: 'needs_remediation' },
    ] };
    const result = await make({ appended, sessions, sessionCorrection }).execute({
      bankId: 'caps', fromDay: '2026-08-01', toDay: '2026-08-02', reason: 'key fixed', regradedBy: 'kckern', apply: true,
    });

    expect(sessionCorrection).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'ses_1',
      correctCount: 1, totalCount: 2, percent: 50, missedItemIds: ['q1'], apply: true }));
    expect(result.sessionCorrections).toEqual([expect.objectContaining({ sessionId: 'ses_1', status: 'corrected' })]);
  });

  it('gate-checked and reason required', async () => {
    const uc = make();
    await expect(uc.execute({ bankId: 'caps', fromDay: '2026-08-01', toDay: '2026-08-02', reason: 'r', regradedBy: 'learner4' }))
      .rejects.toThrow(GuestForbiddenError);
    await expect(uc.execute({ bankId: 'caps', fromDay: '2026-08-01', toDay: '2026-08-02', regradedBy: 'kckern' }))
      .rejects.toThrow(/reason/);
  });
});
