// @vitest-environment node
//
// The grading hook is fired fire-and-forget at all four terminal scan
// outcomes (unresolved / refused / graded / review) — Task 3 of
// 2026-08-22-school-grading-hook. Home automation is a bystander: a slow or
// broken Home Assistant must never delay or prevent a grade being recorded,
// so `gradingHook.fire()` is never awaited into the grading path.
import { describe, it, expect, vi } from 'vitest';
import { createSchoolPrintScanConsumer } from '#composition/modules/schoolPrintScanConsumer.mjs';

// Same calibration fixture `schoolPrintScanConsumer.test.mjs` uses — decodes
// to testId '0123456' with a handful of answered rows. This file never
// asserts on the decode itself; it only needs a stable, real testId/answers
// pair to hand to a fake resolveCardScan.
const CALIBRATION_MARKS = [
  512, 256, 128, 64, 32, 16, 8, // test ID 0123456
  1028, 520, 260, 136, 68, 132, 257, 514, 1040,
  0, 0, 0, 0, 0,
  1092,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

function makeBus() {
  const subs = new Map();
  return {
    subscribe(topic, fn) {
      if (!subs.has(topic)) subs.set(topic, new Set());
      subs.get(topic).add(fn);
      return () => subs.get(topic)?.delete(fn);
    },
    broadcast(topic, payload) {
      for (const listener of subs.get(topic) || []) listener(payload);
    },
    topics: () => [...subs.keys()],
  };
}

function sheetPayload(marks = CALIBRATION_MARKS, over = {}) {
  return {
    event: 'sheet', columns: marks.length, marks, ts: '2026-07-30 21:16:43', source: 'omr-relay', ...over,
  };
}

const silentLogger = () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
});

/** Flushes the microtask queue so the `.then/.catch` chain inside `onPayload` has settled. */
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/**
 * Fake `SchoolGradingHookAdapter`-shaped hook: records every `fire()` call's
 * payload. `rejects: true` rejects every call; `rejectIndexes: [0]` rejects
 * only specific calls by their 0-based order (e.g. the FIRST of two section
 * fires) so a test can prove one rejection doesn't poison the rest of a loop.
 */
function fakeHook({ rejects = false, rejectIndexes = null } = {}) {
  const calls = [];
  return {
    calls,
    fire: vi.fn((outcome) => {
      const index = calls.length;
      calls.push(outcome);
      const shouldReject = rejects || (rejectIndexes?.includes(index) ?? false);
      return shouldReject ? Promise.reject(new Error('hook unreachable')) : Promise.resolve({ ok: true });
    }),
  };
}

const singleCard = (over = {}) => ({
  cardId: '0123456', recordId: 'r1', documentId: 'civilization/atlas/ws-one',
  rev: 'rev1', variant: 0, learnerId: 'milo', sessionId: 'ses-one',
  revisionSuperseded: false, results: [], totalPoints: 6, earnedPoints: 5,
  ...over,
});

describe('gradingHook: fired fire-and-forget at all four terminal scan outcomes', () => {
  it('fires result=graded with the score', async () => {
    const bus = makeBus();
    const gradingHook = fakeHook();
    const card = singleCard();
    const recordCardScanOutcome = {
      execute: vi.fn(async () => ({ recorded: true, session: { sessionId: 'ses-one', advancedTo: 'graded' } })),
    };
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ results: [card] }) },
      recordCardScanOutcome,
      gradingHook,
      logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(gradingHook.calls).toHaveLength(1);
    expect(gradingHook.calls[0]).toMatchObject({
      result: 'graded',
      testId: '0123456',
      learnerId: 'milo',
      earned: 5,
      total: 6,
      percent: 83.33,
      sessionId: 'ses-one',
    });
  });

  it('a composed two-section card fires TWICE, each with its OWN section score, not the card aggregate', async () => {
    // The defect this guards against: firing the whole-card aggregate
    // (earnedPoints/totalPoints) for every section would make section A's
    // 2/2 and section B's 1/3 report the SAME number to Home Assistant. The
    // fake `recordCardScanOutcome.execute` mirrors RecordCardScanOutcome's
    // real composed-return shape (Task 1's fix): a `sectionOutcomes` array
    // whose entries carry their OWN `earnedPoints`/`totalPoints`, correlated
    // by index with the sections that produced them.
    const bus = makeBus();
    const gradingHook = fakeHook();
    // Deliberately mismatched vs. either section, so a fire that fell back
    // to this aggregate instead of the section score would be caught.
    const card = singleCard({ earnedPoints: 999, totalPoints: 999 });
    const recordCardScanOutcome = {
      execute: vi.fn(async () => ({
        recorded: true,
        sectionOutcomes: [
          {
            recorded: true, session: { sessionId: 'sec-a', advancedTo: 'graded' }, earnedPoints: 2, totalPoints: 2,
          },
          {
            recorded: true, session: { sessionId: 'sec-b', advancedTo: 'graded' }, earnedPoints: 1, totalPoints: 3,
          },
        ],
      })),
    };
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ results: [card] }) },
      recordCardScanOutcome,
      gradingHook,
      logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(gradingHook.calls).toHaveLength(2);
    expect(gradingHook.calls[0]).toMatchObject({
      result: 'graded', sessionId: 'sec-a', earned: 2, total: 2, percent: 100,
    });
    expect(gradingHook.calls[1]).toMatchObject({
      result: 'graded', sessionId: 'sec-b', earned: 1, total: 3, percent: 33.33,
    });
    // Neither fire used the card's own (deliberately mismatched) aggregate.
    expect(gradingHook.calls.some((c) => c.earned === 999 || c.total === 999)).toBe(false);
  });

  it('a single non-composed card still reports the card aggregate (no section score to prefer)', async () => {
    const bus = makeBus();
    const gradingHook = fakeHook();
    const card = singleCard({ earnedPoints: 4, totalPoints: 4 });
    const recordCardScanOutcome = {
      // The non-composed shape: `recorded` itself IS the sole "sectionOutcome"
      // (`recorded?.sectionOutcomes ?? [recorded]` in the consumer) and, per
      // RecordCardScanOutcome's real return shape, never carries its own
      // earnedPoints/totalPoints — only `session`.
      execute: vi.fn(async () => ({ recorded: true, session: { sessionId: 'ses-one', advancedTo: 'graded' } })),
    };
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ results: [card] }) },
      recordCardScanOutcome,
      gradingHook,
      logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(gradingHook.calls).toHaveLength(1);
    expect(gradingHook.calls[0]).toMatchObject({
      result: 'graded', sessionId: 'ses-one', earned: 4, total: 4, percent: 100,
    });
  });

  it('fires result=review with pendingReview, reasons and items', async () => {
    const bus = makeBus();
    const gradingHook = fakeHook();
    const card = singleCard();
    const recordCardScanOutcome = {
      execute: vi.fn(async () => ({
        recorded: true,
        session: {
          sessionId: 'ses-one',
          advancedTo: 'submitted',
          reason: 'awaiting-review',
          pendingReview: 2,
          reasons: ['ambiguous', 'free_response'],
          items: ['q3', 'q7'],
        },
      })),
    };
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ results: [card] }) },
      recordCardScanOutcome,
      gradingHook,
      logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(gradingHook.calls).toHaveLength(1);
    expect(gradingHook.calls[0]).toMatchObject({
      result: 'review',
      testId: '0123456',
      learnerId: 'milo',
      sessionId: 'ses-one',
      pendingReview: 2,
      reasons: ['ambiguous', 'free_response'],
      items: ['q3', 'q7'],
    });
  });

  it('fires result=unresolved with the resolver code', async () => {
    const bus = makeBus();
    const gradingHook = fakeHook();
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ error: { code: 'CARD_ID_UNREADABLE' } }) },
      gradingHook,
      logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(gradingHook.calls).toHaveLength(1);
    expect(gradingHook.calls[0]).toMatchObject({
      result: 'unresolved', testId: '0123456', code: 'CARD_ID_UNREADABLE',
    });
  });

  it('fires result=refused with the record code', async () => {
    const bus = makeBus();
    const gradingHook = fakeHook();
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: {
        execute: async () => ({
          results: [
            {
              cardId: '0123456', recordId: 'r1', documentId: 'd1', rev: 'a', variant: 0, learnerId: 'milo',
              error: { code: 'ALLOCATION_ROW_MAPPING_DRIFT' },
            },
          ],
        }),
      },
      gradingHook,
      logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(gradingHook.calls).toHaveLength(1);
    expect(gradingHook.calls[0]).toMatchObject({
      result: 'refused', testId: '0123456', code: 'ALLOCATION_ROW_MAPPING_DRIFT', learnerId: 'milo',
    });
    // `recordId` is deliberately NOT sent — SchoolGradingHookAdapter's
    // `toVariables()` has no `record_id` key in its 11-key contract, so it
    // would be silently discarded; the log line right above already carries it.
    expect(gradingHook.calls[0]).not.toHaveProperty('recordId');
  });

  it('does nothing when no gradingHook is injected', async () => {
    const bus = makeBus();
    const card = singleCard();
    const recordCardScanOutcome = {
      execute: vi.fn(async () => ({ recorded: true, session: { sessionId: 'ses-one', advancedTo: 'graded' } })),
    };
    // No `gradingHook` passed at all — must not throw, and recording proceeds normally.
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ results: [card] }) },
      recordCardScanOutcome,
      logger: silentLogger(),
    });
    expect(() => bus.broadcast('omr', sheetPayload())).not.toThrow();
    await flush();

    expect(recordCardScanOutcome.execute).toHaveBeenCalledTimes(1);
  });

  it('still records the grade when the hook rejects (single section, no closeSessionOutcome wired)', async () => {
    const bus = makeBus();
    const gradingHook = fakeHook({ rejects: true });
    const card = singleCard();
    const recordCardScanOutcome = {
      execute: vi.fn(async () => ({ recorded: true, session: { sessionId: 'ses-one', advancedTo: 'graded' } })),
    };
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ results: [card] }) },
      recordCardScanOutcome,
      gradingHook,
      logger: silentLogger(),
    });
    expect(() => bus.broadcast('omr', sheetPayload())).not.toThrow();
    await flush();
    // Let the rejected `fire()` promise's own microtask settle too — the
    // `.catch(() => {})` at the call site must swallow it silently.
    await flush();

    expect(recordCardScanOutcome.execute).toHaveBeenCalledTimes(1);
    expect(gradingHook.fire).toHaveBeenCalledTimes(1);
  });

  it('the safety claim, actually exercised: a rejection on section A does not poison section B — both fire, both still bridge via closeSessionOutcome', async () => {
    // The case above proves `recordCardScanOutcome.execute` still ran, but it
    // never wires `closeSessionOutcome` and only has one section, so it can't
    // say anything about the `.then()` loop itself surviving a mid-loop
    // rejection. This test wires a REAL closeSessionOutcome stub, uses a
    // COMPOSED two-section card so the loop iterates twice, and rejects
    // specifically on section A's fire (call index 0) — the actual failure
    // mode being guarded against: one hook rejection poisoning the rest of
    // the for-loop and silently dropping section B's bridge call.
    const bus = makeBus();
    const gradingHook = fakeHook({ rejectIndexes: [0] });
    const card = singleCard();
    const recordCardScanOutcome = {
      execute: vi.fn(async () => ({
        recorded: true,
        sectionOutcomes: [
          {
            recorded: true, session: { sessionId: 'sec-a', advancedTo: 'graded' }, earnedPoints: 2, totalPoints: 2,
          },
          {
            recorded: true, session: { sessionId: 'sec-b', advancedTo: 'graded' }, earnedPoints: 1, totalPoints: 3,
          },
        ],
      })),
    };
    const closeSessionOutcome = { execute: vi.fn(async () => ({ status: 'settled', result: 'passed' })) };
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ results: [card] }) },
      recordCardScanOutcome,
      closeSessionOutcome,
      gradingHook,
      logger: silentLogger(),
    });
    expect(() => bus.broadcast('omr', sheetPayload())).not.toThrow();
    await flush();
    // Let the rejected `fire()` promise (section A's) settle too — the
    // `.catch(() => {})` at the call site must swallow it silently and never
    // reach the outer `.then()`'s own `.catch`, which would misreport this
    // as a `scan-record-failed`.
    await flush();

    expect(recordCardScanOutcome.execute).toHaveBeenCalledTimes(1);
    // Both sections' hooks fired — section A's rejection did not stop the
    // loop from reaching section B.
    expect(gradingHook.fire).toHaveBeenCalledTimes(2);
    // Both sections still bridged via closeSessionOutcome — section A's
    // rejected hook promise (never awaited) could not block the `await
    // closeSessionOutcome.execute(...)` immediately below it, nor could it
    // skip section B's own bridge call on the next loop iteration.
    expect(closeSessionOutcome.execute).toHaveBeenCalledTimes(2);
    expect(closeSessionOutcome.execute).toHaveBeenNthCalledWith(1, { sessionId: 'sec-a' });
    expect(closeSessionOutcome.execute).toHaveBeenNthCalledWith(2, { sessionId: 'sec-b' });
  });
});
