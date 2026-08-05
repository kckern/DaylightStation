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
  results: [
    {
      row: 1, itemId: 'q1', itemType: 'multiple_choice', status: 'correct', given: 'blue', points: 1, earned: 1,
    },
    {
      row: 2, itemId: 'q2', itemType: 'multiple_choice', status: 'incorrect', given: 'fox', points: 1, earned: 0,
    },
  ],
  totalPoints: 2,
  earnedPoints: 1,
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
    expect(attempts).toHaveLength(4);
    expect(attempts.at(-1).provenance.reScored).toBe(true);
    expect(scanKey(changed)).not.toBe(scanKey(gradedCard()));
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
