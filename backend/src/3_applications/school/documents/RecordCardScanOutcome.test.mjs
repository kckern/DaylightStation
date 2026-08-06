/**
 * RecordCardScanOutcome — graded scans become durable evidence (review wave
 * B1). Attempts land in the same append-only per-learner log the on-screen
 * engine writes; a session-tracked card advances issued → submitted → graded.
 */
import { describe, it, expect, vi } from 'vitest';
import { RecordCardScanOutcome, scanKey } from './RecordCardScanOutcome.mjs';
import { createEvent } from '#domains/school/sessions/sessionEvents.mjs';

const quietLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function fakeDatastore() {
  const byLearner = new Map();
  return {
    byLearner,
    appendAttempt(learnerId, attempt) {
      if (!byLearner.has(learnerId)) byLearner.set(learnerId, []);
      byLearner.get(learnerId).push(structuredClone(attempt));
      return attempt;
    },
    readAllAttempts(learnerId) {
      return structuredClone(byLearner.get(learnerId) ?? []);
    },
    // Day-bounded read, same semantics as YamlSchoolDatastore.readAttemptsInRange:
    // only attempts whose `at` falls on a day within [fromDay, toDay] (inclusive).
    readAttemptsInRange(learnerId, fromDay, toDay) {
      return structuredClone(byLearner.get(learnerId) ?? [])
        .filter((attempt) => {
          const day = String(attempt.at).slice(0, 10);
          return day >= fromDay && day <= toDay;
        });
    },
  };
}

/** A datastore double that records which read method the use case called, without serving real data. */
function spyDatastore({ renderedDayAttempt, oldAttempt } = {}) {
  const readAttemptsInRange = vi.fn(() => (renderedDayAttempt ? [renderedDayAttempt] : []));
  const readAllAttempts = vi.fn(() => [oldAttempt, renderedDayAttempt].filter(Boolean));
  return {
    readAttemptsInRange,
    readAllAttempts,
    appendAttempt: vi.fn((learnerId, attempt) => attempt),
  };
}

/**
 * In-memory IWorkSessionRepository fake — assigns `seq` on append exactly
 * like the real YamlWorkSessionDatastore (the reducer refuses seq-less events).
 */
function fakeSessions(seedEvents = []) {
  const events = new Map();
  const append = (sessionId, event) => {
    const list = events.get(sessionId) ?? [];
    const seq = list.reduce((max, e) => Math.max(max, e.seq ?? 0), 0) + 1;
    list.push({ ...structuredClone(event), seq });
    events.set(sessionId, list);
  };
  for (const { sessionId, event } of seedEvents) append(sessionId, event);
  return {
    events,
    async readEvents(sessionId) { return structuredClone(events.get(sessionId) ?? []); },
    async appendEvent(sessionId, event) { append(sessionId, event); },
  };
}

/**
 * In-memory `IReviewQueue`-shaped double, scoped to what the bridge needs:
 * enqueue and read back by session. No `resolve`/`listPending` — the bridge
 * never calls them.
 */
function fakeReviewQueue() {
  const items = [];
  return {
    items,
    async enqueue(batch) { items.push(...structuredClone(batch)); },
    async listForSession(sessionId) { return structuredClone(items.filter((i) => i.sessionId === sessionId)); },
  };
}

function seededSession(sessionId, { learnerId = 'felix', unitId = 'unit-1' } = {}) {
  const mk = (payload) => {
    const { errors, event } = createEvent(payload);
    if (errors.length) throw new Error(errors.join('; '));
    return { sessionId, event };
  };
  return [
    mk({
      type: 'created', at: '2026-08-05T00:00:00.000Z', sessionId, unitId, learnerId,
    }),
    mk({
      type: 'issued', at: '2026-08-05T00:01:00.000Z', sessionId, artifactId: 'art-1',
    }),
  ];
}

const gradedCard = (over = {}) => ({
  cardId: '1234567',
  recordId: 'arts/quiz-1@abcdef123:v0:1-2',
  documentId: 'arts/quiz-1',
  rev: 'abcdef123',
  variant: 0,
  learnerId: 'felix',
  revisionSuperseded: false,
  renderedAt: '2026-08-04T00:00:00.000Z',
  results: [
    {
      row: 1, itemId: 'q1', itemType: 'multiple_choice', prompt: null, status: 'correct', given: 'blue', points: 1, earned: 1, concepts: [],
    },
    {
      row: 2, itemId: 'q2', itemType: 'multiple_choice', prompt: null, status: 'incorrect', given: 'fox', points: 1, earned: 0, concepts: [],
    },
  ],
  totalPoints: 2,
  earnedPoints: 1,
  unscannedItems: [],
  ...over,
});

describe('attempt persistence', () => {
  it('appends one paper-transport attempt per answered row, in the engine shape', async () => {
    const datastore = fakeDatastore();
    const useCase = new RecordCardScanOutcome({
      datastore, clock: () => new Date('2026-08-05T10:00:00.000Z'), logger: quietLogger,
    });
    const outcome = await useCase.execute({ testId: '1234567', card: gradedCard() });

    expect(outcome.recorded).toBe(true);
    expect(outcome.attemptIds).toHaveLength(2);
    const attempts = datastore.readAllAttempts('felix');
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      itemId: 'q1',
      itemType: 'multiple_choice',
      given: 'blue',
      correct: true,
      attributedTo: 'felix',
      transport: 'paper',
      provenance: {
        kind: 'omr-card', cardId: '1234567', recordId: 'arts/quiz-1@abcdef123:v0:1-2', row: 1,
      },
    });
    expect(attempts[1].correct).toBe(false);
  });

  it('blank rows produce NO attempt — unresolved, not wrong', async () => {
    const datastore = fakeDatastore();
    const useCase = new RecordCardScanOutcome({ datastore, logger: quietLogger });
    const card = gradedCard({
      results: [
        {
          row: 1, itemId: 'q1', itemType: 'multiple_choice', status: 'correct', given: 'blue', points: 1, earned: 1,
        },
        {
          row: 2, itemId: 'q2', itemType: 'multiple_choice', status: 'blank', given: null, points: 1, earned: 0,
        },
      ],
      earnedPoints: 1,
    });
    const outcome = await useCase.execute({ testId: '1234567', card });
    expect(outcome.attemptIds).toHaveLength(1);
    expect(datastore.readAllAttempts('felix')).toHaveLength(1);
  });

  it('re-feeding the identical card writes nothing new (idempotent per scan content)', async () => {
    const datastore = fakeDatastore();
    const useCase = new RecordCardScanOutcome({ datastore, logger: quietLogger });
    const first = await useCase.execute({ testId: '1234567', card: gradedCard() });
    expect(first.recorded).toBe(true);

    const repeat = await useCase.execute({ testId: '1234567', card: gradedCard() });
    expect(repeat).toMatchObject({ recorded: false, reason: 'duplicate-scan' });
    expect(datastore.readAllAttempts('felix')).toHaveLength(2);
  });

  it('a re-scan with DIFFERENT answers is recorded (real evidence), flagged via provenance', async () => {
    const datastore = fakeDatastore();
    const useCase = new RecordCardScanOutcome({ datastore, logger: quietLogger });
    await useCase.execute({ testId: '1234567', card: gradedCard() });

    const changed = gradedCard({ reScored: true });
    changed.results[1] = { ...changed.results[1], given: 'cat', status: 'correct', earned: 1 };
    const second = await useCase.execute({ testId: '1234567', card: changed });
    expect(second.recorded).toBe(true);
    const attempts = datastore.readAllAttempts('felix');
    expect(attempts).toHaveLength(3); // row 1 deduped (identical given), only row 2 re-appends
    expect(attempts.at(-1).provenance.reScored).toBe(true);
    expect(scanKey(changed)).not.toBe(scanKey(gradedCard()));
  });

  it('attempts are filed under the document taxonomy, not a phantom "derived" subject', async () => {
    const datastore = fakeDatastore();
    const useCase = new RecordCardScanOutcome({ datastore, logger: quietLogger });
    const card = gradedCard({ documentId: 'science/biology/quiz-1', recordId: 'science/biology/quiz-1@abcdef123:v0:1-2' });
    await useCase.execute({ testId: '1234567', card });
    const attempt = datastore.readAllAttempts('felix')[0];
    expect(attempt.bankId).toBe('science/biology/quiz-1@abcdef123');
    expect(attempt.learning.subjectId).toBe('science');
    expect(attempt.sessionId).toBeNull();
  });

  it('a flat (non-hierarchical) documentId files without a subjectId rather than inventing one', async () => {
    const datastore = fakeDatastore();
    const useCase = new RecordCardScanOutcome({ datastore, logger: quietLogger });
    await useCase.execute({ testId: '1234567', card: gradedCard() }); // documentId 'arts/quiz-1' → subjectId 'arts'
    const flat = gradedCard({ documentId: 'quiz-1', recordId: 'quiz-1@abcdef123:v0:9-10' });
    flat.results = flat.results.map((row, i) => ({ ...row, row: 9 + i }));
    await useCase.execute({ testId: '1234567', card: flat });
    const attempts = datastore.readAllAttempts('felix');
    expect(attempts.at(-1).bankId).toBe('quiz-1@abcdef123');
    expect(attempts.at(-1).learning?.subjectId ?? null).toBeNull();
  });

  it('attempts carry course and unit context when the session and taxonomy know them', async () => {
    const datastore = fakeDatastore();
    const sessions = fakeSessions(seededSession('ws-1', { unitId: 'unit-frac-3' }));
    const useCase = new RecordCardScanOutcome({ datastore, sessions, logger: quietLogger });
    const card = gradedCard({
      sessionId: 'ws-1',
      documentId: 'math/fractions/quiz-3',
      recordId: 'math/fractions/quiz-3@abcdef123:v0:1-2',
    });
    card.results[0].concepts = ['fraction-add'];
    await useCase.execute({ testId: '1234567', card });
    const attempt = datastore.readAllAttempts('felix')[0];
    expect(attempt.learning).toMatchObject({
      subjectId: 'math', courseId: 'fractions', unitId: 'unit-frac-3', conceptIds: ['fraction-add'],
    });
  });

  it('carries the work session id in provenance when the card is session-tracked, for evidence-layer reach', async () => {
    const datastore = fakeDatastore();
    const sessions = fakeSessions(seededSession('ws-1', { unitId: 'unit-frac-3' }));
    const useCase = new RecordCardScanOutcome({ datastore, sessions, logger: quietLogger });
    const card = gradedCard({
      sessionId: 'ws-1',
      documentId: 'math/fractions/quiz-3',
      recordId: 'math/fractions/quiz-3@abcdef123:v0:1-2',
    });
    await useCase.execute({ testId: '1234567', card });
    const attempt = datastore.readAllAttempts('felix')[0];
    expect(attempt.sessionId).toBe('ws-1');
    expect(attempt.provenance.workSessionId).toBe('ws-1');
  });

  it('omits workSessionId from provenance when the card carries no session', async () => {
    const datastore = fakeDatastore();
    const useCase = new RecordCardScanOutcome({ datastore, logger: quietLogger });
    await useCase.execute({ testId: '1234567', card: gradedCard() });
    const attempt = datastore.readAllAttempts('felix')[0];
    expect(attempt.sessionId).toBeNull();
    expect(attempt.provenance.workSessionId).toBeUndefined();
  });

  it('a URL-printed sheet (no session) still files subject + course from the taxonomy', async () => {
    const datastore = fakeDatastore();
    const card = gradedCard({ documentId: 'math/fractions/quiz-3', recordId: 'math/fractions/quiz-3@abcdef123:v0:1-2' });
    await new RecordCardScanOutcome({ datastore, logger: quietLogger }).execute({ testId: '1234567', card });
    const attempt = datastore.readAllAttempts('felix')[0];
    expect(attempt.learning).toMatchObject({ subjectId: 'math', courseId: 'fractions' });
    expect(attempt.learning.unitId ?? null).toBeNull();
  });

  it('a partial feed then a complete re-feed appends ONLY the rows not already recorded', async () => {
    const datastore = fakeDatastore();
    const useCase = new RecordCardScanOutcome({ datastore, logger: quietLogger });
    const partial = gradedCard({
      results: [
        { row: 1, itemId: 'q1', itemType: 'multiple_choice', prompt: null, status: 'correct', given: 'blue', points: 1, earned: 1 },
        { row: 2, itemId: 'q2', itemType: 'multiple_choice', prompt: null, status: 'blank', given: null, points: 1, earned: 0 },
      ],
      earnedPoints: 1,
    });
    await useCase.execute({ testId: '1234567', card: partial });
    expect(datastore.readAllAttempts('felix')).toHaveLength(1);

    const complete = gradedCard(); // both rows answered, row 1 identical (given 'blue')
    const second = await useCase.execute({ testId: '1234567', card: complete });
    expect(second.recorded).toBe(true);
    const attempts = datastore.readAllAttempts('felix');
    expect(attempts).toHaveLength(2); // row 1 deduped, only row 2 appended
    expect(attempts.at(-1).itemId).toBe('q2');
  });

  it('graded percent is item-count over rows, matching GradeSubmission semantics', async () => {
    const datastore = fakeDatastore();
    const sessions = fakeSessions(seededSession('ws-1'));
    const useCase = new RecordCardScanOutcome({ datastore, sessions, logger: quietLogger });
    // 1 correct of 2 rows, but the correct row is worth 5 points of 6 total:
    const card = gradedCard({
      sessionId: 'ws-1',
      results: [
        { row: 1, itemId: 'q1', itemType: 'multiple_choice', prompt: null, status: 'correct', given: 'blue', points: 5, earned: 5 },
        { row: 2, itemId: 'q2', itemType: 'multiple_choice', prompt: null, status: 'incorrect', given: 'fox', points: 1, earned: 0 },
      ],
      totalPoints: 6,
      earnedPoints: 5,
    });
    await useCase.execute({ testId: '1234567', card });
    const graded = (await sessions.readEvents('ws-1')).at(-1);
    expect(graded.type).toBe('graded');
    expect(graded.percent).toBe(50); // 1 of 2 items — NOT 83.33 points-weighted
  });

  it('an unattributed scan (no learnerId) records nothing, loudly', async () => {
    const datastore = fakeDatastore();
    const logger = { ...quietLogger, warn: vi.fn() };
    const useCase = new RecordCardScanOutcome({ datastore, logger });
    const outcome = await useCase.execute({ testId: '1234567', card: gradedCard({ learnerId: undefined }) });
    expect(outcome).toMatchObject({ recorded: false, reason: 'unattributed' });
    expect(logger.warn).toHaveBeenCalledWith('school.print.scan-unattributed', expect.anything());
  });
});

describe('dedup read windowing', () => {
  it('a card rendered today scopes the dedup read to [renderedAt day, today] and never touches readAllAttempts', async () => {
    const datastore = spyDatastore();
    const useCase = new RecordCardScanOutcome({
      datastore, clock: () => new Date('2026-08-05T10:00:00.000Z'), logger: quietLogger,
    });
    await useCase.execute({ testId: '1234567', card: gradedCard({ renderedAt: '2026-08-04T00:00:00.000Z' }) });

    expect(datastore.readAttemptsInRange).toHaveBeenCalledWith('felix', '2026-08-04', '2026-08-05');
    expect(datastore.readAllAttempts).not.toHaveBeenCalled();
  });

  it('a legacy card with no renderedAt falls back to the full scan (readAllAttempts)', async () => {
    const datastore = spyDatastore();
    const useCase = new RecordCardScanOutcome({
      datastore, clock: () => new Date('2026-08-05T10:00:00.000Z'), logger: quietLogger,
    });
    await useCase.execute({ testId: '1234567', card: gradedCard({ renderedAt: undefined }) });

    expect(datastore.readAllAttempts).toHaveBeenCalledWith('felix');
    expect(datastore.readAttemptsInRange).not.toHaveBeenCalled();
  });

  it('without readAttemptsInRange on the datastore, dedup still works via the full-scan fallback', async () => {
    const store = fakeDatastore();
    const bareDatastore = {
      appendAttempt: store.appendAttempt.bind(store),
      readAllAttempts: store.readAllAttempts.bind(store),
    };
    const useCase = new RecordCardScanOutcome({
      datastore: bareDatastore, clock: () => new Date('2026-08-05T10:00:00.000Z'), logger: quietLogger,
    });
    const outcome = await useCase.execute({ testId: '1234567', card: gradedCard() });
    expect(outcome.recorded).toBe(true);
    expect(store.readAllAttempts('felix')).toHaveLength(2);
  });
});

describe('session bridge', () => {
  it('a complete scan of a session-tracked card advances issued → submitted → graded with a points percent', async () => {
    const datastore = fakeDatastore();
    const sessions = fakeSessions(seededSession('ws-1'));
    const useCase = new RecordCardScanOutcome({ datastore, sessions, logger: quietLogger });

    const outcome = await useCase.execute({ testId: '1234567', card: gradedCard({ sessionId: 'ws-1' }) });
    expect(outcome.session).toEqual({ sessionId: 'ws-1', advancedTo: 'graded' });

    const types = (await sessions.readEvents('ws-1')).map((event) => event.type);
    expect(types).toEqual(['created', 'issued', 'submitted', 'graded']);
    const graded = (await sessions.readEvents('ws-1')).at(-1);
    expect(graded.percent).toBe(50);
    expect(graded.attemptIds).toEqual(outcome.attemptIds);
  });

  it('a partial scan records attempts but does NOT advance the session', async () => {
    const datastore = fakeDatastore();
    const sessions = fakeSessions(seededSession('ws-1'));
    const useCase = new RecordCardScanOutcome({ datastore, sessions, logger: quietLogger });
    const card = gradedCard({
      sessionId: 'ws-1',
      results: [
        {
          row: 1, itemId: 'q1', itemType: 'multiple_choice', status: 'correct', given: 'blue', points: 1, earned: 1,
        },
        {
          row: 2, itemId: 'q2', itemType: 'multiple_choice', status: 'blank', given: null, points: 1, earned: 0,
        },
      ],
      earnedPoints: 1,
    });
    const outcome = await useCase.execute({ testId: '1234567', card });
    expect(outcome.recorded).toBe(true);
    expect(outcome.session).toMatchObject({ advancedTo: null, reason: 'partial-scan' });
    const types = (await sessions.readEvents('ws-1')).map((event) => event.type);
    expect(types).toEqual(['created', 'issued']);
  });

  it('a session already graded is never advanced twice', async () => {
    const datastore = fakeDatastore();
    const seed = seededSession('ws-1');
    const sessions = fakeSessions(seed);
    const useCase = new RecordCardScanOutcome({ datastore, sessions, logger: quietLogger });
    await useCase.execute({ testId: '1234567', card: gradedCard({ sessionId: 'ws-1' }) });

    // Same record, different answers — the attempts record, the session holds.
    const changed = gradedCard({ sessionId: 'ws-1', reScored: true });
    changed.results[1] = { ...changed.results[1], given: 'cat', status: 'correct', earned: 1 };
    const second = await useCase.execute({ testId: '1234567', card: changed });
    expect(second.session).toMatchObject({ advancedTo: null, reason: 'state-graded' });
    const types = (await sessions.readEvents('ws-1')).map((event) => event.type);
    expect(types).toEqual(['created', 'issued', 'submitted', 'graded']);
  });

  it('a session-side failure never un-records the attempts', async () => {
    const datastore = fakeDatastore();
    const sessions = {
      readEvents: vi.fn().mockRejectedValue(new Error('disk on fire')),
      appendEvent: vi.fn(),
    };
    const useCase = new RecordCardScanOutcome({ datastore, sessions, logger: quietLogger });
    const outcome = await useCase.execute({ testId: '1234567', card: gradedCard({ sessionId: 'ws-1' }) });
    expect(outcome.recorded).toBe(true);
    expect(outcome.session).toMatchObject({ advancedTo: null, reason: 'bridge-failed' });
    expect(datastore.readAllAttempts('felix')).toHaveLength(2);
  });
});

describe('review queue bridge', () => {
  it('a complete scan with an ambiguous row holds at submitted and queues the row for a person', async () => {
    const datastore = fakeDatastore();
    const sessions = fakeSessions(seededSession('ws-1'));
    const reviewQueue = fakeReviewQueue();
    const useCase = new RecordCardScanOutcome({ datastore, sessions, reviewQueue, logger: quietLogger });
    const card = gradedCard({
      sessionId: 'ws-1',
      results: [
        { row: 1, itemId: 'q1', itemType: 'multiple_choice', prompt: 'P1', status: 'correct', given: 'blue', points: 1, earned: 1 },
        { row: 2, itemId: 'q2', itemType: 'multiple_choice', prompt: 'P2', status: 'ambiguous', given: ['A', 'B'], points: 1, earned: 0 },
      ],
      earnedPoints: 1,
    });
    const outcome = await useCase.execute({ testId: '1234567', card });
    expect(outcome.session).toMatchObject({ advancedTo: 'submitted', reason: 'awaiting-review', pendingReview: 1 });
    const types = (await sessions.readEvents('ws-1')).map((e) => e.type);
    expect(types).toEqual(['created', 'issued', 'submitted']); // graded is NOT appended
    // The machine marks are recorded as RESOLVED verdicts; the ambiguous row is pending.
    const pending = reviewQueue.items.filter((i) => !i.verdict);
    expect(pending).toEqual([expect.objectContaining({ itemId: 'q2', reason: 'ambiguous', given: ['A', 'B'], prompt: 'P2' })]);
    const resolved = reviewQueue.items.filter((i) => i.verdict);
    expect(resolved).toEqual([expect.objectContaining({ itemId: 'q1', verdict: 'correct', gradedBy: 'engine' })]);
  });

  it('write-on questions queue as free_response and hold the session at submitted', async () => {
    const datastore = fakeDatastore();
    const sessions = fakeSessions(seededSession('ws-1'));
    const reviewQueue = fakeReviewQueue();
    const useCase = new RecordCardScanOutcome({ datastore, sessions, reviewQueue, logger: quietLogger });
    const card = gradedCard({ sessionId: 'ws-1', unscannedItems: [{ itemId: 'w-essay', prompt: 'Explain.' }] });
    const outcome = await useCase.execute({ testId: '1234567', card });
    expect(outcome.session).toMatchObject({ advancedTo: 'submitted', reason: 'awaiting-review' });
    expect(reviewQueue.items.filter((i) => !i.verdict)).toEqual([
      expect.objectContaining({ itemId: 'w-essay', reason: 'free_response', prompt: 'Explain.' }),
    ]);
  });

  it('no ambiguous rows, no write-ons: graded as before, machine marks still on the verdict sheet', async () => {
    const datastore = fakeDatastore();
    const sessions = fakeSessions(seededSession('ws-1'));
    const reviewQueue = fakeReviewQueue();
    const useCase = new RecordCardScanOutcome({ datastore, sessions, reviewQueue, logger: quietLogger });
    const outcome = await useCase.execute({ testId: '1234567', card: gradedCard({ sessionId: 'ws-1', unscannedItems: [] }) });
    expect(outcome.session).toEqual({ sessionId: 'ws-1', advancedTo: 'graded' });
    expect(reviewQueue.items.every((i) => i.gradedBy === 'engine')).toBe(true);
  });

  it('without a reviewQueue wired, behavior degrades to wave-1 (graded when complete) — never a crash', async () => {
    const datastore = fakeDatastore();
    const sessions = fakeSessions(seededSession('ws-1'));
    const useCase = new RecordCardScanOutcome({ datastore, sessions, logger: quietLogger });
    const outcome = await useCase.execute({ testId: '1234567', card: gradedCard({ sessionId: 'ws-1' }) });
    expect(outcome.session).toEqual({ sessionId: 'ws-1', advancedTo: 'graded' });
  });
});
