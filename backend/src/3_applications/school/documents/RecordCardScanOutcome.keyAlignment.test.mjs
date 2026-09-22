/**
 * RecordCardScanOutcome — key-alignment routing (OMR key-alignment check,
 * Task 3). `ResolveCardScan` (Task 2) stamps `card.keyAlignmentSuspect` when
 * a whole-card row shift would score meaningfully better than the literal
 * read. This bridge's job is to route that suspicion to a grown-up through
 * the SAME review-queue mechanism an ambiguous bubble or a free-response
 * item already uses — never to score it itself.
 */
import { describe, it, expect, vi } from 'vitest';
import { RecordCardScanOutcome } from './RecordCardScanOutcome.mjs';
import { createEvent } from '#domains/school/sessions/sessionEvents.mjs';

const quietLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
};

function fakeDatastore() {
  const byLearner = new Map();
  return {
    appendAttempt(learnerId, attempt) {
      if (!byLearner.has(learnerId)) byLearner.set(learnerId, []);
      byLearner.get(learnerId).push(structuredClone(attempt));
      return attempt;
    },
    readAllAttempts(learnerId) { return structuredClone(byLearner.get(learnerId) ?? []); },
    readAttemptsInRange(learnerId, fromDay, toDay) {
      return structuredClone(byLearner.get(learnerId) ?? [])
        .filter((attempt) => { const day = String(attempt.at).slice(0, 10); return day >= fromDay && day <= toDay; });
    },
  };
}

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
    async readEvents(sessionId) { return structuredClone(events.get(sessionId) ?? []); },
    async appendEvent(sessionId, event) { append(sessionId, event); },
  };
}

function fakeReviewQueue() {
  const items = [];
  return {
    items,
    async enqueue(batch) { items.push(...structuredClone(batch)); },
    async listForSession(sessionId) { return structuredClone(items.filter((i) => i.sessionId === sessionId)); },
  };
}

function seededSession(sessionId, { learnerId = 'test-learner', unitId = 'test-unit' } = {}) {
  const mk = (payload) => {
    const { errors, event } = createEvent(payload);
    if (errors.length) throw new Error(errors.join('; '));
    return { sessionId, event };
  };
  return [
    mk({
      type: 'created', at: '2026-09-21T00:00:00.000Z', sessionId, unitId, learnerId,
    }),
    mk({
      type: 'issued', at: '2026-09-21T00:00:01.000Z', sessionId, artifactId: 'art-1',
    }),
  ];
}

const gradedCard = (over = {}) => ({
  cardId: '1234567',
  recordId: 'civilization/test/worksheet@rev1:v0:1-6',
  documentId: 'civilization/test/worksheet',
  rev: 'rev1',
  variant: 0,
  learnerId: 'test-learner',
  sessionId: 'ses_test1',
  results: [1, 2, 3, 4, 5, 6].map((n) => ({
    row: n,
    itemId: `q${n}`,
    itemType: 'multiple_choice',
    prompt: `Q${n}`,
    status: n === 1 ? 'incorrect' : 'correct',
    given: 'A',
    points: 1,
    earned: n === 1 ? 0 : 1,
    concepts: [],
  })),
  totalPoints: 6,
  earnedPoints: 5,
  unscannedItems: [],
  ...over,
});

describe('RecordCardScanOutcome key-alignment routing', () => {
  it('halts the session at submitted, awaiting-review, when keyAlignmentSuspect is set', async () => {
    const sessions = fakeSessions(seededSession('ses_test1'));
    const reviewQueue = fakeReviewQueue();
    const datastore = fakeDatastore();
    const recorder = new RecordCardScanOutcome({
      datastore, sessions, reviewQueue, clock: () => new Date('2026-09-21T00:05:00.000Z'), logger: quietLogger,
    });
    const card = gradedCard({
      keyAlignmentSuspect: {
        offset: -1, literalMatches: 2, shiftedMatches: 5, itemCount: 6,
      },
    });
    const outcome = await recorder.execute({ testId: '1234567', card });
    expect(outcome.session.reason).toBe('awaiting-review');
    expect(outcome.session.advancedTo).toBe('submitted');
    const suspectItem = reviewQueue.items.find((item) => item.reason === 'key-alignment-suspected');
    expect(suspectItem).toBeTruthy();
    expect(suspectItem.itemId).toBe('key-alignment');
    expect(suspectItem.prompt).toBe('Row alignment check');
    expect(suspectItem.rubric).toMatch(/row/i);
  });

  it('grades normally, with no key-alignment pending entry, when the field is absent', async () => {
    const sessions = fakeSessions(seededSession('ses_test2'));
    const reviewQueue = fakeReviewQueue();
    const datastore = fakeDatastore();
    const recorder = new RecordCardScanOutcome({
      datastore, sessions, reviewQueue, clock: () => new Date('2026-09-21T00:05:00.000Z'), logger: quietLogger,
    });
    const card = gradedCard({ recordId: 'civilization/test/worksheet@rev1:v0:1-6', sessionId: 'ses_test2' });
    const outcome = await recorder.execute({ testId: '1234567', card });
    expect(outcome.session.reason).not.toBe('awaiting-review');
    expect(reviewQueue.items.some((item) => item.reason === 'key-alignment-suspected')).toBe(false);
  });
});

/**
 * Whole-branch review finding #2: `ResolveCardScan` now computes
 * `keyAlignmentSuspect` PER SECTION on a composed card (one physical card,
 * several independently gradeable lessons); this bridge must route each
 * section's OWN value to that section's OWN session only, never lean on the
 * `...card` spread that used to carry the whole-record value onto every
 * section regardless of which lesson it actually concerned.
 */
describe('RecordCardScanOutcome key-alignment routing — composed sections', () => {
  it('holds only the flagged section, never leaking a stale whole-card value onto the unflagged one', async () => {
    const sessions = fakeSessions([
      ...seededSession('ses_a', { unitId: 'lesson-a' }),
      ...seededSession('ses_b', { unitId: 'lesson-b' }),
    ]);
    const reviewQueue = fakeReviewQueue();
    const datastore = fakeDatastore();
    const recorder = new RecordCardScanOutcome({
      datastore, sessions, reviewQueue, clock: () => new Date('2026-09-21T00:05:00.000Z'), logger: quietLogger,
    });
    const sectionRows = (prefix, startRow) => [0, 1, 2].map((i) => ({
      row: startRow + i, itemId: `${prefix}${i + 1}`, itemType: 'multiple_choice', prompt: `${prefix}${i + 1}`,
      status: 'correct', given: 'A', points: 1, earned: 1, concepts: [],
    }));
    const sectionA = { id: 'lesson-a', rowRange: { start: 1, end: 3 }, sessionId: 'ses_a',
      results: sectionRows('a', 1), totalPoints: 3, earnedPoints: 3,
      keyAlignmentSuspect: { offset: -1, literalMatches: 0, shiftedMatches: 3, itemCount: 3 } };
    const sectionB = { id: 'lesson-b', rowRange: { start: 4, end: 6 }, sessionId: 'ses_b',
      results: sectionRows('b', 4), totalPoints: 3, earnedPoints: 3 };
    // A defensive stale value on the OUTER card — exactly what a pre-fix
    // `ResolveCardScan` used to leave at the whole-record level regardless
    // of sections. If this bridge ever falls back to reading it (instead of
    // each section's own), lesson B would wrongly hold too.
    const card = gradedCard({
      recordId: 'civilization/test/composed@rev1:v0:1-6',
      keyAlignmentSuspect: { offset: -1, literalMatches: 0, shiftedMatches: 5, itemCount: 6 },
      results: [...sectionA.results, ...sectionB.results],
      totalPoints: 6, earnedPoints: 6,
      sections: [sectionA, sectionB],
    });
    const outcome = await recorder.execute({ testId: '1234567', card });
    const [outcomeA, outcomeB] = outcome.sectionOutcomes;
    expect(outcomeA.session.reason).toBe('awaiting-review');
    expect(outcomeB.session.reason).not.toBe('awaiting-review');
    const aQueueItems = reviewQueue.items.filter((item) => item.sessionId === 'ses_a');
    const bQueueItems = reviewQueue.items.filter((item) => item.sessionId === 'ses_b');
    expect(aQueueItems.some((item) => item.reason === 'key-alignment-suspected')).toBe(true);
    expect(bQueueItems.some((item) => item.reason === 'key-alignment-suspected')).toBe(false);
  });
});
