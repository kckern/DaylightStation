// @vitest-environment node
//
// Slice C, Task C1 (2026-08-22-omr-grading-integrity): the ceremony Slice D
// builds needs the four terminal scan outcomes on the event bus, not just in
// the logs and the (separately tested) Home Assistant hook. This consumer is
// a SECOND, parallel listener on the same outcomes the grading hook already
// fires from — see schoolPrintScanConsumerHook.test.mjs for the hook's own
// coverage, which this file must never duplicate or disturb.
//
// Reuses the SAME `omr` topic the relay already broadcasts sheets on (per
// the brief), so the frontend needs no new transport to subscribe.
import { describe, it, expect, vi } from 'vitest';
import { createSchoolPrintScanConsumer } from '#composition/modules/schoolPrintScanConsumer.mjs';

// Same calibration fixture the sibling composition tests use — decodes to
// testId '0123456' with a handful of answered rows. This file never asserts
// on the decode itself; it only needs a stable, real testId/answers pair to
// hand to a fake resolveCardScan.
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
    broadcast: vi.fn((topic, payload) => {
      for (const listener of subs.get(topic) || []) listener(payload);
    }),
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

const singleCard = (over = {}) => ({
  cardId: '0123456', recordId: 'r1', documentId: 'civilization/atlas/ws-one',
  rev: 'rev1', variant: 0, learnerId: 'milo', sessionId: 'ses-one',
  revisionSuperseded: false, results: [], totalPoints: 6, earnedPoints: 5,
  ...over,
});

// Only the four `scan-*` events this consumer itself emits count as outcome
// broadcasts — filters out both the test's own seed `sheet` broadcast and
// (in the reader-error test) a manually-broadcast `reader-error` payload
// that this consumer must never re-emit itself.
const outcomeCalls = (bus) => bus.broadcast.mock.calls.filter(([, payload]) => payload?.event?.startsWith('scan-'));

describe('createSchoolPrintScanConsumer: broadcasts the four terminal scan outcomes on the omr bus', () => {
  it('broadcasts scan-graded with the SESSION-sourced (row-count) score, not the card points aggregate', async () => {
    const bus = makeBus();
    // Deliberately mismatched vs. the session numbers below, so a broadcast
    // that fell back to the card's points aggregate instead of the
    // session-derived score (the same Fix-3 discipline the grading hook
    // follows) would be caught.
    const card = singleCard({ earnedPoints: 999, totalPoints: 999 });
    const recordCardScanOutcome = {
      execute: vi.fn(async () => ({
        recorded: true,
        session: {
          sessionId: 'ses-one', advancedTo: 'graded', percent: 83.33, correctCount: 5, totalCount: 6,
        },
      })),
    };
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ results: [card] }) },
      recordCardScanOutcome,
      logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    const calls = outcomeCalls(bus);
    expect(calls).toHaveLength(1);
    const [topic, payload] = calls[0];
    expect(topic).toBe('omr');
    expect(payload).toMatchObject({
      event: 'scan-graded',
      learnerId: 'milo',
      correctCount: 5,
      totalCount: 6,
      percent: 83.33,
      result: 'graded',
    });
    // Never the card's own (deliberately mismatched) points aggregate.
    expect(payload.correctCount).not.toBe(999);
    expect(payload.totalCount).not.toBe(999);
  });

  it('broadcasts scan-graded ONCE PER SECTION on a composed worksheet, each with its own section score', async () => {
    const bus = makeBus();
    const card = singleCard();
    const recordCardScanOutcome = {
      execute: vi.fn(async () => ({
        recorded: true,
        sectionOutcomes: [
          {
            recorded: true,
            session: {
              sessionId: 'sec-a', advancedTo: 'graded', percent: 100, correctCount: 2, totalCount: 2,
            },
          },
          {
            recorded: true,
            session: {
              sessionId: 'sec-b', advancedTo: 'graded', percent: 33.33, correctCount: 1, totalCount: 3,
            },
          },
        ],
      })),
    };
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ results: [card] }) },
      recordCardScanOutcome,
      logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    const calls = outcomeCalls(bus);
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toMatchObject({
      event: 'scan-graded', correctCount: 2, totalCount: 2, percent: 100,
    });
    expect(calls[1][1]).toMatchObject({
      event: 'scan-graded', correctCount: 1, totalCount: 3, percent: 33.33,
    });
  });

  it('broadcasts scan-review with pendingReview, reasons and items', async () => {
    const bus = makeBus();
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
      logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    const calls = outcomeCalls(bus);
    expect(calls).toHaveLength(1);
    const [topic, payload] = calls[0];
    expect(topic).toBe('omr');
    expect(payload).toMatchObject({
      event: 'scan-review',
      learnerId: 'milo',
      pendingReview: 2,
      reasons: ['ambiguous', 'free_response'],
      items: ['q3', 'q7'],
    });
  });

  it('broadcasts scan-unresolved with the resolver error code', async () => {
    const bus = makeBus();
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ error: { code: 'CARD_ID_UNREADABLE' } }) },
      logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    const calls = outcomeCalls(bus);
    expect(calls).toHaveLength(1);
    const [topic, payload] = calls[0];
    expect(topic).toBe('omr');
    expect(payload).toMatchObject({
      event: 'scan-unresolved',
      code: 'CARD_ID_UNREADABLE',
      testId: '0123456',
    });
    expect(Array.isArray(payload.testIdCandidates)).toBe(true);
  });

  it('broadcasts scan-refused with the per-record code', async () => {
    const bus = makeBus();
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
      logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    const calls = outcomeCalls(bus);
    expect(calls).toHaveLength(1);
    const [topic, payload] = calls[0];
    expect(topic).toBe('omr');
    expect(payload).toMatchObject({
      event: 'scan-refused',
      code: 'ALLOCATION_ROW_MAPPING_DRIFT',
      recordId: 'r1',
    });
  });

  it('does not duplicate reader-error — that already broadcasts from omrRelay.mjs', async () => {
    // This consumer never listens for/re-broadcasts `reader-error` itself;
    // it only reacts to `event: 'sheet'` payloads (see onPayload's own
    // guard). Feeding it a reader-error payload must produce zero outcome
    // broadcasts.
    const bus = makeBus();
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ results: [] }) },
      logger: silentLogger(),
    });
    bus.broadcast('omr', { event: 'reader-error', echo: null, ts: '2026-07-30 21:16:43', source: 'omr-relay' });
    await flush();

    expect(outcomeCalls(bus)).toHaveLength(0);
  });
});
