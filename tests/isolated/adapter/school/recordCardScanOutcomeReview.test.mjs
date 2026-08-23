// @vitest-environment node
//
// The spec's variable contract requires `reasons` and `items` on the
// `review` outcome. `RecordCardScanOutcome` already computes both for its
// `school.print.scan-awaiting-review` log line — this pins that they also
// reach the caller, which is the only way the grading hook can name WHICH
// row stopped the session.
import { describe, it, expect, vi } from 'vitest';
import { RecordCardScanOutcome } from '#apps/school/documents/RecordCardScanOutcome.mjs';
import { createEvent } from '#domains/school/sessions/sessionEvents.mjs';

const quietLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
};

/** In-memory datastore double — mirrors RecordCardScanOutcome.test.mjs's own `fakeDatastore`. */
function fakeDatastore() {
  const byLearner = new Map();
  return {
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
    async readEvents(sessionId) { return structuredClone(events.get(sessionId) ?? []); },
    async appendEvent(sessionId, event) { append(sessionId, event); },
  };
}

/**
 * In-memory `IReviewQueue`-shaped double, scoped to what the bridge needs:
 * enqueue only — the awaiting-review branch never reads it back.
 */
function fakeReviewQueue() {
  const items = [];
  return {
    items,
    async enqueue(batch) { items.push(...structuredClone(batch)); },
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

/**
 * Drives `RecordCardScanOutcome` to the awaiting-review branch: a
 * session-tracked, complete card whose two rows both resolve `ambiguous`
 * (item ids `q1`/`q2`) — same reason on both, so `reasons` dedupes to one
 * entry while `items` keeps both.
 */
async function runAwaitingReviewCase() {
  const datastore = fakeDatastore();
  const sessions = fakeSessions(seededSession('ws-1'));
  const reviewQueue = fakeReviewQueue();
  const useCase = new RecordCardScanOutcome({
    datastore, sessions, reviewQueue, logger: quietLogger,
  });
  const card = {
    cardId: '1234567',
    recordId: 'arts/quiz-1@abcdef123:v0:1-2',
    documentId: 'arts/quiz-1',
    rev: 'abcdef123',
    variant: 0,
    learnerId: 'felix',
    sessionId: 'ws-1',
    revisionSuperseded: false,
    renderedAt: '2026-08-04T00:00:00.000Z',
    results: [
      {
        row: 1, itemId: 'q1', itemType: 'multiple_choice', prompt: 'P1', status: 'ambiguous', given: ['A', 'B'], points: 1, earned: 0, concepts: [],
      },
      {
        row: 2, itemId: 'q2', itemType: 'multiple_choice', prompt: 'P2', status: 'ambiguous', given: ['A', 'B'], points: 1, earned: 0, concepts: [],
      },
    ],
    totalPoints: 2,
    earnedPoints: 0,
    unscannedItems: [],
  };
  const outcome = await useCase.execute({ testId: '1234567', card });
  return { result: outcome.session, logger: quietLogger };
}

describe('RecordCardScanOutcome — awaiting-review return shape', () => {
  it('returns reasons and items alongside pendingReview', async () => {
    const { result } = await runAwaitingReviewCase();
    expect(result.reason).toBe('awaiting-review');
    expect(result.pendingReview).toBe(2);
    expect(result.reasons).toEqual(['ambiguous']);
    expect(result.items).toEqual(['q1', 'q2']);
  });

  it('deduplicates reasons but not items', async () => {
    const { result } = await runAwaitingReviewCase();
    // two pending rows, both 'ambiguous' -> one reason, two items
    expect(result.reasons).toHaveLength(1);
    expect(result.items).toHaveLength(2);
  });
});
