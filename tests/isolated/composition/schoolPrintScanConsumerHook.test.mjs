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

/** Fake `SchoolGradingHookAdapter`-shaped hook: records every `fire()` call's payload. */
function fakeHook({ rejects = false } = {}) {
  const calls = [];
  return {
    calls,
    fire: vi.fn((outcome) => {
      calls.push(outcome);
      return rejects ? Promise.reject(new Error('hook unreachable')) : Promise.resolve({ ok: true });
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
      sessionId: 'ses-one',
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
      result: 'refused', testId: '0123456', recordId: 'r1', code: 'ALLOCATION_ROW_MAPPING_DRIFT', learnerId: 'milo',
    });
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

  it('still records the grade when the hook rejects', async () => {
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
});
