// @vitest-environment node
//
// The `scan-graded` broadcast must say WHETHER PAPER CAME OUT.
//
// The panel's scan ceremony (frontend/src/modules/School/selfService/
// useScanCeremony.js) became a FALLBACK rather than a receipt: when the
// result receipt prints, the paper IS the feedback and announcing the grade
// on a wall screen in a shared room is both redundant and a small public
// humiliation. The panel can only make that call if the wire tells it, so
// `scan-graded` carries `printed` / `printReason` — the SAME pair
// `CloseSessionOutcome#execute` already returns (`ReceiptPrinting.print()`'s
// `{printed, reason}`, threaded through `#printed`).
//
// The ordering consequence is the point of this file: the broadcast now
// happens AFTER the settle rather than before it, because before it the
// print outcome does not exist yet. Everything that could go wrong with that
// reordering — a settle that throws, a settle that is not wired at all — must
// still leave the child with a ceremony, because "no ceremony" is only ever
// correct when paper is known to have come out.
import { describe, it, expect, vi } from 'vitest';
import { createSchoolPrintScanConsumer } from '#composition/modules/schoolPrintScanConsumer.mjs';

// Same calibration fixture the sibling composition tests use — decodes to
// testId '0123456'. Nothing here asserts on the decode itself.
const CALIBRATION_MARKS = [
  512, 256, 128, 64, 32, 16, 8,
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

const sheetPayload = () => ({
  event: 'sheet', columns: CALIBRATION_MARKS.length, marks: CALIBRATION_MARKS,
  ts: '2026-08-25 09:00:00', source: 'omr-relay',
});

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });

/** Flushes the microtask queue so `onPayload`'s promise chain has settled. */
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

const singleCard = (over = {}) => ({
  cardId: '0123456', recordId: 'r1', documentId: 'civilization/atlas/ws-one',
  rev: 'rev1', variant: 0, learnerId: 'milo', sessionId: 'ses-one',
  revisionSuperseded: false, results: [], totalPoints: 6, earnedPoints: 5,
  ...over,
});

const gradedRecorder = () => ({
  execute: vi.fn(async () => ({
    recorded: true,
    session: { sessionId: 'ses-one', advancedTo: 'graded', percent: 83.33, correctCount: 5, totalCount: 6 },
  })),
});

const gradedBroadcasts = (bus) => bus.broadcast.mock.calls
  .filter(([, payload]) => payload?.event === 'scan-graded')
  .map(([, payload]) => payload);

function build({ closeSessionOutcome = null } = {}) {
  const bus = makeBus();
  createSchoolPrintScanConsumer({
    eventBus: bus,
    resolveCardScan: { execute: async () => ({ results: [singleCard()] }) },
    recordCardScanOutcome: gradedRecorder(),
    closeSessionOutcome,
    logger: silentLogger(),
  });
  return bus;
}

describe('createSchoolPrintScanConsumer: scan-graded carries the print outcome', () => {
  it('reports printed:true when the result receipt reached the roll', async () => {
    const bus = build({
      closeSessionOutcome: {
        execute: vi.fn(async () => ({ status: 'settled', result: 'passed', printed: true, printReason: null })),
      },
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    const [graded] = gradedBroadcasts(bus);
    expect(graded).toMatchObject({
      event: 'scan-graded', correctCount: 5, totalCount: 6, result: 'passed', printed: true,
    });
    expect(graded.printReason).toBeNull();
  });

  it('reports printed:false with the reason when the receipt did not print', async () => {
    const bus = build({
      closeSessionOutcome: {
        execute: vi.fn(async () => ({
          status: 'settled', result: 'passed', printed: false, printReason: 'printer_error',
        })),
      },
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(gradedBroadcasts(bus)[0]).toMatchObject({ printed: false, printReason: 'printer_error' });
  });

  it('reports printed:false when no settle step is wired at all — nothing printed, so the screen must speak', async () => {
    const bus = build();
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(gradedBroadcasts(bus)[0]).toMatchObject({ printed: false, printReason: 'not_settled' });
  });

  it('still broadcasts (printed:false) when the settle throws — a settle failure may never swallow the ceremony', async () => {
    const bus = build({
      closeSessionOutcome: { execute: vi.fn(async () => { throw new Error('store offline'); }) },
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    const [graded] = gradedBroadcasts(bus);
    expect(graded).toBeDefined();
    expect(graded.printed).toBe(false);
    expect(graded.printReason).toBe('settle_failed');
    // The grade itself is still reported; only the settled result is unknown.
    expect(graded).toMatchObject({ correctCount: 5, totalCount: 6, result: 'graded' });
  });

  it('broadcasts once per section on a composed worksheet, each with its own print outcome', async () => {
    const bus = makeBus();
    const closeSessionOutcome = {
      execute: vi.fn(async ({ sessionId }) => (sessionId === 'sec-a'
        ? { status: 'settled', result: 'passed', printed: true, printReason: null }
        : { status: 'settled', result: 'passed', printed: false, printReason: 'printer_error' })),
    };
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ results: [singleCard()] }) },
      recordCardScanOutcome: {
        execute: vi.fn(async () => ({
          recorded: true,
          sectionOutcomes: [
            { recorded: true, session: { sessionId: 'sec-a', advancedTo: 'graded', percent: 100, correctCount: 2, totalCount: 2 } },
            { recorded: true, session: { sessionId: 'sec-b', advancedTo: 'graded', percent: 33.33, correctCount: 1, totalCount: 3 } },
          ],
        })),
      },
      closeSessionOutcome,
      logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    const graded = gradedBroadcasts(bus);
    expect(graded).toHaveLength(2);
    expect(graded[0]).toMatchObject({ sessionId: 'sec-a', printed: true });
    expect(graded[1]).toMatchObject({ sessionId: 'sec-b', printed: false, printReason: 'printer_error' });
  });
});
