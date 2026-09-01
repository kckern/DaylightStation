import { describe, expect, it, vi } from 'vitest';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';
import { effectiveAttempts } from '#domains/school/attempt.mjs';
import { InvalidateSessionEvidence } from './InvalidateSessionEvidence.mjs';
import { MarkSessionAbandoned } from './MarkSessionAbandoned.mjs';
import { RecoverMisattributedWorksheet } from './RecoverMisattributedWorksheet.mjs';
import {
  FakeSessionRepository, fakeClock, silentLogger,
} from '../../../../../tests/_lib/school/lifecycleFakes.mjs';

const SOURCE = 'ses_math_wrong';
const CREDIT = 'ses_scripture';
const REMEDIATION = 'ses_math_retry';
const OLD_CARD = '8684155';
const CURRENT_CARD = '8424408';

function fakeIo() {
  const files = new Map();
  return {
    load: (filePath) => (files.has(filePath) ? structuredClone(files.get(filePath)) : null),
    save: (filePath, content) => files.set(filePath, structuredClone(content)),
    list: () => [...files.keys()].map((filePath) => filePath.match(/([^/]+)\.yml$/)?.[1]).filter(Boolean),
  };
}

const allocationRequest = ({ documentId, sessionId, start, end, itemPrefix, ...extra }) => ({
  documentId,
  rev: `${documentId}-rev`,
  seed: start * 1000 + end,
  variant: 0,
  learnerId: 'milo',
  sessionId,
  rowRange: { start, end },
  rowItems: Array.from({ length: end - start + 1 }, (_, index) => ({
    row: start + index,
    itemId: `${itemPrefix}${index + 1}`,
    itemType: 'multiple_choice',
  })),
  ...extra,
});

async function append(sessions, sessionId, type, at, payload = {}) {
  await sessions.appendEvent(sessionId, { type, at, sessionId, ...payload });
}

async function harness() {
  const clock = fakeClock('2026-08-31T18:00:00.000Z');
  const sessions = new FakeSessionRepository();
  const teacherGate = { assert: vi.fn() };
  const allocationStore = new YamlAllocationStore({
    directory: '/print', io: fakeIo(), now: clock.iso, timeZone: 'America/Los_Angeles',
    rng: () => 0.4, logger: silentLogger,
  });

  await append(sessions, SOURCE, 'created', '2026-08-31T01:26:54.276Z', {
    learnerId: 'milo', unitId: 'math-place-value', studyDay: '2026-08-30',
  });
  await append(sessions, SOURCE, 'issued', '2026-08-31T01:28:24.563Z', {
    artifactId: 'math/original', confirmed: true,
  });
  await append(sessions, SOURCE, 'submitted', '2026-08-31T15:49:14.032Z', { transport: 'paper' });
  await append(sessions, SOURCE, 'graded', '2026-08-31T15:49:14.032Z', {
    attemptIds: ['att_5', 'att_6'], percent: 16.67, correctCount: 1, totalCount: 6,
    missedItemIds: ['math-q1', 'math-q2', 'math-q3', 'math-q5', 'math-q6'],
  });
  await append(sessions, SOURCE, 'outcome_recorded', '2026-08-31T15:49:14.098Z', {
    outcomeId: `out:${SOURCE}`, result: 'needs_remediation', reason: 'below_passing',
  });
  await append(sessions, SOURCE, 'remediation_opened', '2026-08-31T15:56:18.320Z', {
    newSessionId: REMEDIATION, variant: 1,
  });
  await append(sessions, REMEDIATION, 'created', '2026-08-31T15:56:18.320Z', {
    learnerId: 'milo', unitId: 'math-place-value', remediationOf: SOURCE,
    remediationItemIds: ['math-q1', 'math-q2', 'math-q3', 'math-q5', 'math-q6'], variant: 1,
  });
  await append(sessions, REMEDIATION, 'issued', '2026-08-31T15:56:18.325Z', {
    artifactId: 'math/retry', confirmed: true,
  });
  await append(sessions, CREDIT, 'created', '2026-08-31T14:43:23.028Z', {
    learnerId: 'milo', unitId: 'scripture-psalms', studyDay: '2026-08-31',
  });
  await append(sessions, CREDIT, 'issued', '2026-08-31T15:30:09.071Z', {
    artifactId: 'scripture/worksheet', confirmed: true,
  });
  await append(sessions, CREDIT, 'reprinted', '2026-08-31T17:28:00.261Z', {
    artifactId: 'scripture/worksheet', confirmed: true,
  });

  const sourceRecord = await allocationStore.allocate({
    cardId: OLD_CARD,
    request: allocationRequest({
      documentId: 'math/original', sessionId: SOURCE, start: 22, end: 27, itemPrefix: 'math-q',
      generation: 2, predecessorCardId: '4071314',
    }),
  });
  await allocationStore.updateStatus({ cardId: OLD_CARD, recordId: sourceRecord.recordId, status: 'satisfied' });
  await allocationStore.allocate({
    cardId: OLD_CARD,
    request: allocationRequest({
      documentId: 'math/retry', sessionId: REMEDIATION, start: 28, end: 32, itemPrefix: 'retry-q',
      generation: 2, predecessorCardId: '4071314',
    }),
  });
  await allocationStore.allocate({
    cardId: CURRENT_CARD,
    request: allocationRequest({
      documentId: 'scripture/worksheet', sessionId: CREDIT, start: 1, end: 3, itemPrefix: 'scripture-q',
      generation: 3, predecessorCardId: OLD_CARD,
    }),
  });

  const attempts = Array.from({ length: 6 }, (_, index) => ({
    id: `att_${index + 1}`,
    at: '2026-08-31T15:49:14.032Z',
    sessionId: SOURCE,
    bankId: 'math/original@rev',
    itemId: `math-q${index + 1}`,
    itemType: 'multiple_choice',
    mode: 'quiz',
    given: String(index + 1),
    correct: index === 3,
    attributedTo: 'milo',
    transport: 'paper',
    learning: {},
  }));
  const datastore = {
    readAllAttempts: vi.fn(() => structuredClone(attempts)),
    appendAttempt: vi.fn((_learnerId, attempt) => attempts.push(structuredClone(attempt))),
  };
  const invalidateSessionEvidence = new InvalidateSessionEvidence({
    sessions, datastore, teacherGate, clock: clock.now, logger: silentLogger,
  });
  const submitPaperWork = {
    execute: vi.fn(async ({ sessionId }) => {
      await append(sessions, sessionId, 'submitted', clock.iso(), { transport: 'paper' });
      return { status: 'submitted', sessionId };
    }),
  };
  const gradeSubmission = {
    execute: vi.fn(async ({ sessionId }) => {
      await append(sessions, sessionId, 'graded', clock.iso(), {
        attemptIds: [`review:${sessionId}`], percent: 100,
        passingPercent: 80, correctCount: 3, totalCount: 3, missedItemIds: [],
      });
      return { status: 'graded', sessionId, percent: 100 };
    }),
  };
  const closeSessionOutcome = {
    execute: vi.fn(async ({ sessionId }) => {
      await append(sessions, sessionId, 'outcome_recorded', clock.iso(), {
        outcomeId: `out:${sessionId}`, result: 'passed', reason: 'passing_score',
      });
      return { status: 'settled', sessionId, result: 'passed' };
    }),
  };
  const markSessionAbandoned = new MarkSessionAbandoned({
    sessions, teacherGate, clock: clock.now, logger: silentLogger,
  });
  const issueDocument = {
    execute: vi.fn(async ({ sessionId }) => {
      const request = allocationRequest({
        documentId: `math/recovery/${sessionId}`, sessionId,
        start: 1, end: 6, itemPrefix: 'fresh-math-q',
      });
      const { record } = await allocationStore.allocateNext({ request, policy: { reuse: 'until_full', capacity: 50 } });
      await allocationStore.markDelivered({ cardId: record.cardId, recordId: record.recordId, at: clock.iso() });
      await append(sessions, sessionId, 'issued', clock.iso(), {
        artifactId: `math/recovery/${sessionId}`, confirmed: true,
      });
      return { status: 'issued', sessionId, artifactId: `math/recovery/${sessionId}` };
    }),
  };
  const useCase = new RecoverMisattributedWorksheet({
    sessions, allocationStore, teacherGate, invalidateSessionEvidence,
    submitPaperWork, gradeSubmission, closeSessionOutcome, markSessionAbandoned,
    issueDocument, clock: clock.now, newSessionId: () => 'ses_fresh_math', logger: silentLogger,
  });
  return {
    useCase, sessions, allocationStore, attempts, teacherGate,
    submitPaperWork, gradeSubmission, closeSessionOutcome, issueDocument,
  };
}

const request = (apply = false) => ({
  sourceSessionId: SOURCE,
  creditedSessionId: CREDIT,
  remediationSessionId: REMEDIATION,
  sourceCardId: OLD_CARD,
  currentCardId: CURRENT_CARD,
  sourceRows: [22, 23, 24],
  targetRows: [1, 2, 3],
  marks: ['B', 'B', 'B'],
  reason: 'scripture bubbles were entered in the math row window',
  recoveredBy: 'parent',
  pin: '7410',
  idempotencyKey: 'milo-2026-08-31-wrong-worksheet',
  expectedReplacementRows: { start: 4, end: 9 },
  apply,
});

describe('RecoverMisattributedWorksheet', () => {
  it('previews the complete repair without changing attempts, sessions, cards, or printing', async () => {
    const h = await harness();
    const result = await h.useCase.execute(request(false));
    expect(result).toMatchObject({
      applied: false,
      source: { sessionId: SOURCE, cardId: OLD_CARD, effectiveGrade: null },
      credited: { sessionId: CREDIT, cardId: CURRENT_CARD, marks: ['B', 'B', 'B'], percent: 100 },
      remediation: { sessionId: REMEDIATION, rows: { start: 28, end: 32 }, targetState: 'abandoned' },
      retiredCardId: OLD_CARD,
      replacement: { sessionId: null, remediation: false, questionCount: 6, cardId: CURRENT_CARD, rows: { start: 4, end: 9 } },
    });
    expect(h.attempts).toHaveLength(6);
    expect(h.sessions.derive(CREDIT).state).toBe('reprinted');
    expect(h.sessions.derive(REMEDIATION).state).toBe('issued');
    expect(h.issueDocument.execute).not.toHaveBeenCalled();
    expect((await h.allocationStore.findByCard(OLD_CARD)).some((row) => row.cardRetiredAt)).toBe(false);
  });

  it('credits Scripture 3/3, voids all Math, retires the old card, and issues a full fresh worksheet on rows 4-9', async () => {
    const h = await harness();
    const first = await h.useCase.execute(request(true));
    expect(first).toMatchObject({
      applied: true,
      source: { effectiveGrade: null },
      credited: { percent: 100, marks: ['B', 'B', 'B'] },
      replacement: {
        sessionId: 'ses_fresh_math', remediation: false, questionCount: 6,
        cardId: CURRENT_CARD, rows: { start: 4, end: 9 },
      },
    });
    expect(effectiveAttempts(h.attempts)).toEqual([]);
    expect(h.sessions.derive(SOURCE)).toMatchObject({
      evidenceInvalidated: true,
      gradedPercent: null,
      machineGrade: { percent: 16.67, totalCount: 6 },
      outcome: { result: 'voided', reason: 'evidence_invalidated' },
    });
    expect(h.sessions.derive(CREDIT)).toMatchObject({
      gradedPercent: 100, gradedCorrectCount: 3, gradedTotalCount: 3,
      outcome: { result: 'passed' },
      evidenceAttributions: [expect.objectContaining({
        sourceSessionId: SOURCE, sourceCardId: OLD_CARD,
        sourceRows: [22, 23, 24], targetCardId: CURRENT_CARD,
        targetRows: [1, 2, 3], marks: ['B', 'B', 'B'],
      })],
    });
    expect(h.sessions.derive(REMEDIATION).state).toBe('abandoned');
    expect(h.sessions.derive('ses_fresh_math')).toMatchObject({
      unitId: 'math-place-value', remediationOf: null, remediationItemIds: [], state: 'issued',
      replacesSessionId: SOURCE,
    });
    const old = await h.allocationStore.findByCard(OLD_CARD);
    expect(old.every((row) => row.cardRetiredAt === '2026-08-31T18:00:00.000Z')).toBe(true);
    expect(old.find((row) => row.sessionId === REMEDIATION)).toMatchObject({
      status: 'released', deliveryState: 'delivered', deliveredAt: '2026-08-31T15:56:18.325Z',
    });
    const current = await h.allocationStore.findByCard(CURRENT_CARD);
    expect(current.find((row) => row.sessionId === CREDIT)).toMatchObject({
      status: 'satisfied', deliveryState: 'delivered', deliveredAt: '2026-08-31T15:30:09.071Z',
    });
    expect(current.find((row) => row.sessionId === 'ses_fresh_math')).toMatchObject({
      rowRange: { start: 4, end: 9 }, deliveryState: 'delivered',
      generation: 3, predecessorCardId: OLD_CARD,
      rowItems: expect.arrayContaining([expect.objectContaining({ row: 9, itemId: 'fresh-math-q6' })]),
    });

    const second = await h.useCase.execute(request(true));
    expect(second.replacement.sessionId).toBe('ses_fresh_math');
    expect(h.sessions.ids().filter((id) => id === 'ses_fresh_math')).toHaveLength(1);
    expect(h.issueDocument.execute).toHaveBeenCalledTimes(1);
    expect(h.submitPaperWork.execute).toHaveBeenCalledTimes(1);
    expect(h.gradeSubmission.execute).toHaveBeenCalledTimes(1);
    expect(h.closeSessionOutcome.execute).toHaveBeenCalledTimes(1);
  });
});
