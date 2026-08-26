// @vitest-environment node
//
// A scan never happens silently.
//
// On 2026-08-25 three sheets were fed to the study reader. All three decoded,
// two recorded a fresh attempt, and NOTHING came back — no print, no sound, no
// ceremony on the portal. The sheets were re-feeds of already-scanned paper,
// so recording nothing new was correct; saying nothing about it was not.
//
// The cause was a missing `else`: the per-record handler broadcast only for
// `advancedTo === 'graded'` and `reason === 'awaiting-review'`, so every other
// terminal state (`duplicate-scan`, `state-rewarded`, `session-missing`, a
// partial re-feed) fell off the end of the branch with no broadcast and no
// hook. This file holds the rule that replaces it: if a sheet produced no
// ceremony of its own, it gets one.
//
// ONE ceremony per physical sheet, not per record — a card carrying six
// records must not fire six sounds at a child standing at the scanner.
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
  ts: '2026-08-25 20:08:00', source: 'omr-relay',
});

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });

const card = (recordId) => ({
  cardId: '0123456', recordId, documentId: 'civilization/atlas/ws-one',
  rev: 'rev1', variant: 0, learnerId: 'milo', sessionId: 'ses-one',
  revisionSuperseded: false, results: [], totalPoints: 6, earnedPoints: 5,
});

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

const eventsNamed = (bus, name) => bus.broadcast.mock.calls
  .filter(([, payload]) => payload?.event === name)
  .map(([, payload]) => payload);

function build({ records = ['r1'], recorder }) {
  const bus = makeBus();
  createSchoolPrintScanConsumer({
    eventBus: bus,
    resolveCardScan: { execute: async () => ({ results: records.map(card) }) },
    recordCardScanOutcome: recorder,
    closeSessionOutcome: null,
    logger: silentLogger(),
  });
  return bus;
}

// The real shapes RecordCardScanOutcome returns on its silent paths.
const rewardedRecorder = () => ({
  execute: vi.fn(async () => ({
    recorded: true,
    session: { sessionId: 'ses-one', advancedTo: null, reason: 'state-rewarded' },
  })),
});
const duplicateRecorder = () => ({
  execute: vi.fn(async () => ({ recorded: false, reason: 'duplicate-scan' })),
});
const gradedRecorder = () => ({
  execute: vi.fn(async () => ({
    recorded: true,
    session: { sessionId: 'ses-one', advancedTo: 'graded', percent: 83.33, correctCount: 5, totalCount: 6 },
  })),
});

describe('createSchoolPrintScanConsumer: a scan always makes a mark on the room', () => {
  it('answers a re-fed sheet whose session was already rewarded', async () => {
    const bus = build({ recorder: rewardedRecorder() });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(eventsNamed(bus, 'scan-not-recorded')).toHaveLength(1);
  });

  it('answers a sheet whose every row was already recorded', async () => {
    const bus = build({ recorder: duplicateRecorder() });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(eventsNamed(bus, 'scan-not-recorded')).toHaveLength(1);
  });

  it('speaks ONCE for a card carrying six records, not once per record', async () => {
    const bus = build({
      records: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'],
      recorder: duplicateRecorder(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(eventsNamed(bus, 'scan-not-recorded')).toHaveLength(1);
  });

  it('stays quiet when the sheet already earned a ceremony of its own', async () => {
    const bus = build({ recorder: gradedRecorder() });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(eventsNamed(bus, 'scan-graded')).toHaveLength(1);
    expect(eventsNamed(bus, 'scan-not-recorded')).toHaveLength(0);
  });

  it('stays quiet when no recorder is wired — it never tried, so it cannot claim nothing was recorded', async () => {
    // The resolve-and-score-only composition (a ResolveCardScan with no
    // RecordCardScanOutcome) is a legitimate wiring, not a silent scan.
    const bus = makeBus();
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => ({ results: [card('r1')] }) },
      recordCardScanOutcome: null,
      closeSessionOutcome: null,
      logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(eventsNamed(bus, 'scan-not-recorded')).toHaveLength(0);
  });

  it('names the sheet it is talking about', async () => {
    const bus = build({ recorder: rewardedRecorder() });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(eventsNamed(bus, 'scan-not-recorded')[0]).toMatchObject({
      testId: '0123456', learnerId: 'milo',
    });
  });
});
