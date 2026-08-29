// @vitest-environment node
//
// Composition wiring: `ResolveCardScan` joined to the SAME decoded-scan
// stream `createQuizScanRecorder` already persists (Task 7, spec §9).
import { describe, it, expect, vi } from 'vitest';
import { createSchoolPrintScanConsumer } from '#composition/modules/schoolPrintScanConsumer.mjs';
import { RenderPrintDocument } from '#apps/school/documents/RenderPrintDocument.mjs';
import { createPrintDocumentRendering } from '#rendering/school/documents/PrintDocumentRendering.mjs';
import { PublishPrintDocument } from '#apps/school/documents/PublishPrintDocument.mjs';
import { ResolveCardScan } from '#apps/school/documents/ResolveCardScan.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';
import { DOCUMENT_SOURCE_SCHEMA } from '#domains/school/documents/documentSource.mjs';

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

  it('a CARD_ID_UNREADABLE (or any resolver error) logs at WARN (not debug) and never throws', async () => {
    // 9a5537bb7 (OMR/print integrity slice A, 2026-08-22) raised this from
    // debug to warn on purpose: production runs at `info`, so at debug this
    // line — the single best explanation for "I scanned it and nothing
    // happened" — left an unreadable card with no trace at all. It also
    // started carrying the candidate/answer counts alongside the code.
    const bus = makeBus();
    const logger = silentLogger();
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ error: { code: 'CARD_ID_UNREADABLE' } }) },
      logger,
    });
    bus.broadcast('omr', sheetPayload());
    await flush();
    expect(logger.warn).toHaveBeenCalledWith('school.print.scan-unresolved', expect.objectContaining({
      testId: '0123456', code: 'CARD_ID_UNREADABLE',
    }));
    expect(logger.debug).not.toHaveBeenCalled();
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

  it('closes a fully graded issuing session so the result receipt is printed', async () => {
    const bus = makeBus();
    const card = {
      cardId: '0123456', recordId: 'r1', documentId: 'civilization/atlas/ws-one',
      rev: 'rev1', variant: 0, learnerId: 'learner3', sessionId: 'ses-one',
      revisionSuperseded: false, results: [], totalPoints: 6, earnedPoints: 6,
    };
    const recordCardScanOutcome = {
      execute: vi.fn(async () => ({ session: { sessionId: 'ses-one', advancedTo: 'graded' } })),
    };
    const closeSessionOutcome = { execute: vi.fn(async () => ({ status: 'settled', result: 'passed' })) };
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ results: [card] }) },
      recordCardScanOutcome, closeSessionOutcome, logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();
    expect(recordCardScanOutcome.execute).toHaveBeenCalledWith({ testId: '0123456', card, cardIdInferred: null });
    expect(closeSessionOutcome.execute).toHaveBeenCalledWith({ sessionId: 'ses-one' });
  });

  it("a dead card with answers warns — the child's work must not vanish below warn", async () => {
    const bus = makeBus();
    const logger = silentLogger();
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: {
        execute: async () => ({
          results: [], deadCard: true, answeredRowCount: 4, recordStatuses: ['released'],
        }),
      },
      logger,
    });
    bus.broadcast('omr', sheetPayload());
    await flush();
    expect(logger.warn).toHaveBeenCalledWith('school.print.scan-dead-card', expect.objectContaining({
      testId: '0123456', answeredRowCount: 4, recordStatuses: ['released'],
    }));
  });

  // A warn line is read by a grown-up later; the child is at the scanner NOW.
  // Both of these outcomes used to log and return with nothing on the wire, so
  // a real sheet with real answers produced no ceremony at all — the "nothing
  // happened" failure spec §6.2 forbids.
  it('a dead card ALSO broadcasts its own stale-sheet ceremony — a self-service fix, not a grown-up', async () => {
    const bus = makeBus();
    const seen = [];
    bus.subscribe('omr', (p) => { if (p?.event) seen.push(p); });
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: {
        execute: async () => ({
          results: [], deadCard: true, answeredRowCount: 4, recordStatuses: ['released'],
        }),
      },
      logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();
    expect(seen).toContainEqual({ event: 'scan-stale-sheet', code: 'dead_card', testId: '0123456' });
    // NOT scan-refused: that copy sends the child to find a grown-up, and a
    // stale sheet is fixed by scanning their own card for a fresh print.
    expect(seen.some((p) => p.event === 'scan-refused')).toBe(false);
  });

  it('an unknown card ALSO broadcasts a refusal ceremony — same child action as a per-record refusal', async () => {
    const bus = makeBus();
    const seen = [];
    bus.subscribe('omr', (p) => { if (p?.event) seen.push(p); });
    const logger = silentLogger();
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: {
        execute: async () => ({
          results: [], unknownCard: true, answeredRowCount: 4, nearMissCardIds: ['0123457'],
        }),
      },
      logger,
    });
    bus.broadcast('omr', sheetPayload());
    await flush();
    expect(logger.warn).toHaveBeenCalledWith('school.print.scan-unknown-card', expect.objectContaining({
      testId: '0123456', answeredRowCount: 4, nearMissCardIds: ['0123457'],
    }));
    // The `code` is what tells a grown-up "card id we have never seen" apart
    // from "record on a known card refused"; the child sees the same words.
    expect(seen).toContainEqual({ event: 'scan-refused', code: 'unknown_card', recordId: null });
  });

  it('reports unmarked live records to the HOUSE, not the panel — no child action, and a panel event would be overwritten', async () => {
    const bus = makeBus();
    const seen = [];
    bus.subscribe('omr', (p) => { if (p?.event) seen.push(p); });
    const gradingHook = { fire: vi.fn(async () => ({ ok: true })) };
    const logger = silentLogger();
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: {
        // A MIXED card — one record resolved, another live record got zero
        // marks. `silentLiveRecords` is only reachable this way: an outcome
        // with no results at all returns earlier, at `scan-no-allocation`.
        execute: async () => ({
          results: [{
            cardId: '0123456', recordId: 'r2', documentId: 'd2', rev: 'a', variant: 0,
            revisionSuperseded: false, results: [], totalPoints: 1, earnedPoints: 1,
          }],
          silentLiveRecords: [{ recordId: 'r9', rowRange: '1-5' }],
        }),
      },
      gradingHook,
      logger,
    });
    bus.broadcast('omr', sheetPayload());
    await flush();
    expect(logger.warn).toHaveBeenCalledWith('school.print.scan-live-record-unmarked', expect.objectContaining({
      testId: '0123456', silentLiveRecords: [{ recordId: 'r9', rowRange: '1-5' }],
    }));
    expect(gradingHook.fire).toHaveBeenCalledWith({
      result: 'partial',
      testId: '0123456',
      code: 'live_record_unmarked',
      silentLiveRecords: [{ recordId: 'r9', rowRange: '1-5' }],
    });
    // Nothing about the blank rows reaches the child's panel — that is the
    // point. The resolved record still runs its own ceremony.
    expect(seen.some((p) => p.code === 'live_record_unmarked')).toBe(false);
  });

  it('fires the grading hook for both, so an unreadable sheet is not silent to the house either', async () => {
    for (const [outcome, code] of [
      [{ results: [], unknownCard: true, answeredRowCount: 4, nearMissCardIds: [] }, 'unknown_card'],
      [{ results: [], deadCard: true, answeredRowCount: 4, recordStatuses: ['released'] }, 'dead_card'],
    ]) {
      const bus = makeBus();
      const gradingHook = { fire: vi.fn(async () => ({ ok: true })) };
      createSchoolPrintScanConsumer({
        eventBus: bus,
        resolveCardScan: { execute: async () => outcome },
        gradingHook,
        logger: silentLogger(),
      });
      bus.broadcast('omr', sheetPayload());
      await flush();
      expect(gradingHook.fire).toHaveBeenCalledWith({ result: 'unresolved', testId: '0123456', code });
    }
  });

  it('a per-record refusal (drift / resolve failure) warns per record and is excluded from scan-resolved', async () => {
    const bus = makeBus();
    const logger = silentLogger();
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: {
        execute: async () => ({
          results: [
            {
              cardId: '0123456', recordId: 'r1', documentId: 'd1', rev: 'a', variant: 0,
              error: { code: 'ALLOCATION_ROW_MAPPING_DRIFT' },
            },
            {
              cardId: '0123456', recordId: 'r2', documentId: 'd2', rev: 'a', variant: 0,
              revisionSuperseded: false, results: [], totalPoints: 1, earnedPoints: 1,
            },
          ],
        }),
      },
      logger,
    });
    bus.broadcast('omr', sheetPayload());
    await flush();
    expect(logger.warn).toHaveBeenCalledWith('school.print.scan-record-refused', expect.objectContaining({
      recordId: 'r1', code: 'ALLOCATION_ROW_MAPPING_DRIFT',
    }));
    const resolvedCalls = logger.info.mock.calls.filter(([event]) => event === 'school.print.scan-resolved');
    expect(resolvedCalls).toHaveLength(1);
    expect(resolvedCalls[0][1].recordId).toBe('r2');
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

describe('composed end-to-end: a bank-select document through a REAL ResolveCardScan (F2 review fix, High)', () => {
  // `app.mjs` used to construct `ResolveCardScan` with no `banks` reader at
  // all — a legacy/inline-question tracked quiz issued/scanned fine, but a
  // bank-select document's scan died as BANK_SELECT_BANK_NOT_FOUND (this
  // describe block's first test reproduces exactly that: since Task 1's
  // resolver resilience, a single record's resolve failure surfaces as a
  // per-record `error` in `outcome.results`, not a rejected promise — so it
  // is this describe block's own `school.print.scan-record-refused` warn,
  // per record, that carries the diagnosis now). The fix threads a
  // `createYamlBankReader({ dataDir })` into the SAME constructor call — this
  // block's second test proves that, with a bank reader wired (mirroring the
  // fixed composition), the identical document resolves and grades end to
  // end through the composed consumer, not just through `ResolveCardScan` in
  // isolation (that seam is already covered by `ResolveCardScan.test.mjs`).
  const externalBank = {
    id: 'consumer-external-bank',
    items: [
      {
        id: 'ext1', type: 'multiple_choice', prompt: 'Capital of France?', choices: ['Paris', 'Lyon'], answer: 'Paris',
      },
    ],
  };
  const banks = { getBank: (id) => (id === externalBank.id ? externalBank : null) };

  /** `YamlPrintDocumentRepository`-shaped fake — mirrors `ResolveCardScan.test.mjs`'s own copy. */
  function fakeRepository() {
    const published = new Map();
    const latestRevById = new Map();
    return {
      async writePublished({ document, rev }) {
        published.set(`${document.id}@${rev}`, document);
        latestRevById.set(document.id, rev);
        return { document: { written: true, alreadyPublished: false }, bank: null };
      },
      async getPublished(id, rev) {
        const resolvedRev = rev ?? latestRevById.get(id);
        return resolvedRev ? (published.get(`${id}@${resolvedRev}`) ?? null) : null;
      },
      async getDerivedBank() { return null; },
    };
  }

  /** Publishes and card-attach renders a one-question bank-select quiz onto cardId '0123456' at row 1 — the SAME testId/row-1 answer ('A') this module's own `CALIBRATION_MARKS` fixture decodes, so a real `bus.broadcast` + real decode drives the scan. */
  async function allocateBankSelectQuizOnCalibrationCard() {
    const repository = fakeRepository();
    const map = new Map();
    const allocationStore = new YamlAllocationStore({
      directory: '/docs',
      io: {
        load: (filePath) => (map.has(filePath) ? structuredClone(map.get(filePath)) : null),
        save: (filePath, content) => { map.set(filePath, structuredClone(content)); },
      },
    });
    const source = {
      schema: DOCUMENT_SOURCE_SCHEMA,
      id: 'consumer-bank-select-quiz',
      seed: 42,
      variant: 0,
      target: ['letter'],
      archetype: 'quiz',
      title: 'Consumer Bank Select Quiz',
      blocks: [{ type: 'question', bankId: externalBank.id, select: 1, key: 'sel1' }],
    };
    const publisher = new PublishPrintDocument({ repository });
    const { id, rev } = await publisher.execute({ source });
    const published = await repository.getPublished(id, rev);
    const renderer = new RenderPrintDocument({
      repository, banks, allocationStore, rendering: createPrintDocumentRendering(),
    });
    await renderer.execute({ document: published, context: { cardId: '0123456', startRow: 1 } });
    return { repository, allocationStore };
  }

  it('reproduces the bug: a ResolveCardScan wired with NO banks reader (the pre-fix app.mjs shape) refuses the record, surfaced as a per-record scan-record-refused warn', async () => {
    const { repository, allocationStore } = await allocateBankSelectQuizOnCalibrationCard();
    const resolveCardScan = new ResolveCardScan({ allocationStore, repository }); // no `banks` — the F2 bug
    const bus = makeBus();
    const logger = silentLogger();
    createSchoolPrintScanConsumer({ eventBus: bus, resolveCardScan, logger });

    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(logger.warn).toHaveBeenCalledWith('school.print.scan-record-refused', expect.objectContaining({
      testId: '0123456', code: 'BANK_SELECT_BANK_NOT_FOUND',
    }));
    // Never the whole-scan-level fallback warn — the resolver already turned
    // this into a per-record diagnosis (Task 1), not a rejection.
    expect(logger.warn).not.toHaveBeenCalledWith('school.print.scan-resolve-failed', expect.anything());
  });

  it('the fix: a ResolveCardScan wired WITH a banks reader (mirrors app.mjs\'s createYamlBankReader({ dataDir })) resolves and grades the same bank-select document end to end through the composed consumer', async () => {
    const { repository, allocationStore } = await allocateBankSelectQuizOnCalibrationCard();
    const resolveCardScan = new ResolveCardScan({ allocationStore, repository, banks });
    const bus = makeBus();
    const logger = silentLogger();
    createSchoolPrintScanConsumer({ eventBus: bus, resolveCardScan, logger });

    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(logger.warn).not.toHaveBeenCalled();
    // CALIBRATION_MARKS decodes row 1 to 'A' — the sole bank item's own
    // answer ('Paris') sits at choice A, so this also grades correct; the
    // main claim here is that resolution reached grading at ALL (a
    // `scan-resolved` line), never BANK_SELECT_BANK_NOT_FOUND.
    expect(logger.info).toHaveBeenCalledWith('school.print.scan-resolved', expect.objectContaining({
      testId: '0123456', documentId: 'consumer-bank-select-quiz', earnedPoints: 1, totalPoints: 1,
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
