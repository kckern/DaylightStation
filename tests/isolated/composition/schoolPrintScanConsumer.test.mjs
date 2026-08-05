// @vitest-environment node
//
// Composition wiring: `ResolveCardScan` joined to the SAME decoded-scan
// stream `createQuizScanRecorder` already persists (Task 7, spec §9).
import { describe, it, expect, vi } from 'vitest';
import { createSchoolPrintScanConsumer } from '#composition/modules/schoolPrintScanConsumer.mjs';

// The calibration sheet scanned 2026-07-30 21:16:43 (quizScanRecorder.test.mjs's
// own fixture, reused verbatim) — decodes to testId '0123456' with a handful of
// answered rows. This test never asserts on the DECODE itself (that's
// quizScanRecorder.test.mjs's job); it only needs a stable, real testId/answers
// pair to hand to a fake ResolveCardScan.
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

describe('constructor', () => {
  it('requires an eventBus with subscribe', () => {
    expect(() => createSchoolPrintScanConsumer({ resolveCardScan: { execute: async () => ({}) } }))
      .toThrow(/eventBus/);
  });

  it('requires a resolveCardScan with execute', () => {
    expect(() => createSchoolPrintScanConsumer({ eventBus: makeBus() })).toThrow(/resolveCardScan/);
  });
});

describe('topic subscription', () => {
  it('subscribes to the default omr topic plus any reader-specific topics (mirrors createQuizScanRecorder)', () => {
    const bus = makeBus();
    createSchoolPrintScanConsumer({
      eventBus: bus,
      config: { scanners: { study: { topic: 'omr-study' } } },
      resolveCardScan: { execute: async () => ({ results: [] }) },
      logger: silentLogger(),
    });
    expect(bus.topics().sort()).toEqual(['omr', 'omr-study']);
  });
});

describe('non-sheet / malformed payloads', () => {
  it('ignores a payload that is not a "sheet" event', async () => {
    const bus = makeBus();
    const execute = vi.fn(async () => ({ results: [] }));
    createSchoolPrintScanConsumer({ eventBus: bus, resolveCardScan: { execute }, logger: silentLogger() });
    bus.broadcast('omr', { event: 'reader-error' });
    await flush();
    expect(execute).not.toHaveBeenCalled();
  });

  it('ignores a payload with no marks array', async () => {
    const bus = makeBus();
    const execute = vi.fn(async () => ({ results: [] }));
    createSchoolPrintScanConsumer({ eventBus: bus, resolveCardScan: { execute }, logger: silentLogger() });
    bus.broadcast('omr', { event: 'sheet' });
    await flush();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('resolution outcomes', () => {
  it('decodes the sheet and calls resolveCardScan.execute with {testId, answers}', async () => {
    const bus = makeBus();
    const execute = vi.fn(async () => ({ results: [] }));
    createSchoolPrintScanConsumer({ eventBus: bus, resolveCardScan: { execute }, logger: silentLogger() });
    bus.broadcast('omr', sheetPayload());
    await flush();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ testId: '0123456' });
    expect(execute.mock.calls[0][0].answers).toMatchObject({ 1: 'A' });
  });

  it('a CARD_ID_UNREADABLE (or any resolver error) logs at debug and never throws', async () => {
    const bus = makeBus();
    const logger = silentLogger();
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ error: { code: 'CARD_ID_UNREADABLE' } }) },
      logger,
    });
    bus.broadcast('omr', sheetPayload());
    await flush();
    expect(logger.debug).toHaveBeenCalledWith('school.print.scan-unresolved', expect.objectContaining({
      testId: '0123456', code: 'CARD_ID_UNREADABLE',
    }));
    expect(logger.warn).not.toHaveBeenCalled();
    // Only the constructor's own "ready" line — no per-resolution info log
    // for an unreadable card.
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('school.print.scan-consumer.ready', expect.anything());
  });

  it('a card with no live/satisfied allocation (empty results) logs at debug, not a warning — never treated as an error', async () => {
    const bus = makeBus();
    const logger = silentLogger();
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ results: [], unallocatedRows: [1, 2] }) },
      logger,
    });
    bus.broadcast('omr', sheetPayload());
    await flush();
    expect(logger.debug).toHaveBeenCalledWith('school.print.scan-no-allocation', expect.objectContaining({
      testId: '0123456', unallocatedRows: [1, 2],
    }));
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs one info line PER resolved card, carrying the grading summary', async () => {
    const bus = makeBus();
    const logger = silentLogger();
    const outcome = {
      results: [
        {
          cardId: '4829306', recordId: 'quiz-a@rev1:v0:1-10', documentId: 'quiz-a', rev: 'rev1', variant: 0,
          learnerId: 'kid1', revisionSuperseded: false, results: [], totalPoints: 10, earnedPoints: 8,
        },
        {
          cardId: '4829306', recordId: 'quiz-b@rev2:v0:11-20', documentId: 'quiz-b', rev: 'rev2', variant: 0,
          revisionSuperseded: true, results: [], totalPoints: 5, earnedPoints: 5,
        },
      ],
    };
    createSchoolPrintScanConsumer({ eventBus: bus, resolveCardScan: { execute: async () => outcome }, logger });
    bus.broadcast('omr', sheetPayload());
    await flush();
    expect(logger.info).toHaveBeenCalledTimes(1 + 2); // ready + one per card
    expect(logger.info).toHaveBeenCalledWith('school.print.scan-resolved', expect.objectContaining({
      testId: '0123456', cardId: '4829306', documentId: 'quiz-a', earnedPoints: 8, totalPoints: 10, learnerId: 'kid1',
    }));
    expect(logger.info).toHaveBeenCalledWith('school.print.scan-resolved', expect.objectContaining({
      testId: '0123456', cardId: '4829306', documentId: 'quiz-b', revisionSuperseded: true, learnerId: null,
    }));
  });

  it('a rejected resolveCardScan.execute logs a warning and never throws out of the bus handler', async () => {
    const bus = makeBus();
    const logger = silentLogger();
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => { throw new Error('store unavailable'); } },
      logger,
    });
    expect(() => bus.broadcast('omr', sheetPayload())).not.toThrow();
    await flush();
    expect(logger.warn).toHaveBeenCalledWith('school.print.scan-resolve-failed', expect.objectContaining({
      testId: '0123456', error: 'store unavailable',
    }));
  });
});

describe('dispose', () => {
  it('unsubscribes from every topic it subscribed to', async () => {
    const bus = makeBus();
    const execute = vi.fn(async () => ({ results: [] }));
    const { dispose } = createSchoolPrintScanConsumer({ eventBus: bus, resolveCardScan: { execute }, logger: silentLogger() });
    dispose();
    bus.broadcast('omr', sheetPayload());
    await flush();
    expect(execute).not.toHaveBeenCalled();
  });
});
