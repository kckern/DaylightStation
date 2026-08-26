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
  rev: 'rev1', variant: 0, learnerId: 'learner3', sessionId: 'ses-one',
  revisionSuperseded: false, results: [], totalPoints: 6, earnedPoints: 5,
});

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

const eventsNamed = (bus, name) => bus.broadcast.mock.calls
  .filter(([, payload]) => payload?.event === name)
  .map(([, payload]) => payload);

function build({ records = ['r1'], recorder, outcome, logger }) {
  const bus = makeBus();
  createSchoolPrintScanConsumer({
    eventBus: bus,
    resolveCardScan: {
      execute: async () => outcome ?? { results: records.map(card), cardRecordCount: records.length },
    },
    recordCardScanOutcome: recorder,
    closeSessionOutcome: null,
    logger: logger ?? silentLogger(),
  });
  return bus;
}

/**
 * The outcome `ResolveCardScan` returns for the 2026-08-26 signature: a
 * cumulative card whose LIVE record (today's worksheet) got zero marks while
 * the older, already-satisfied rows still carry last week's marks. `results`
 * is empty because the one eligible record owned no answered row.
 */
const unmarkedLiveRows = () => ({
  results: [],
  cardRecordCount: 7,
  unallocatedRows: Array.from({ length: 33 }, (_, i) => i + 1),
  silentLiveRecords: [{
    recordId: 'civilization/atlas/ws-today@rev1:v0:34-39',
    documentId: 'civilization/atlas/ws-today',
    rowRange: { start: 34, end: 39 },
    learnerId: 'learner3',
  }],
});

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
      testId: '0123456', learnerId: 'learner3',
    });
  });
});

// 2026-08-26. A child fed his card FOUR times in two and a half minutes and
// the room stayed silent every time — no paper, no banner, no error tone.
//
// His card is cumulative: six finished worksheets in rows 1-33, and today's
// live worksheet in rows 34-39. He had not bubbled 34-39, so the only marks on
// the card were the old ones. `ResolveCardScan` narrowed to the live record,
// found none of its rows answered, filed it under `silentLiveRecords` and
// returned `results: []`.
//
// The consumer then returned on `!results.length` — ABOVE the
// `silentLiveRecords` warn written for exactly this signature, above the
// `spoke` tracker, and above the `scan-not-recorded` backstop that the block
// directly overhead calls "the backstop that makes 'every' literal". The
// guarantee and the path that violated it never met.
describe('createSchoolPrintScanConsumer: a live worksheet with blank rows still speaks', () => {
  it('answers a card whose live rows are blank while the old rows carry marks', async () => {
    const bus = build({ outcome: unmarkedLiveRows(), recorder: duplicateRecorder() });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(eventsNamed(bus, 'scan-rows-unmarked')).toHaveLength(1);
  });

  it('names the rows the child still has to fill in', async () => {
    const bus = build({ outcome: unmarkedLiveRows(), recorder: duplicateRecorder() });
    bus.broadcast('omr', sheetPayload());
    await flush();

    // Without the row range the child cannot act: on a cumulative card there
    // is no way to tell which block of rows is today's.
    expect(eventsNamed(bus, 'scan-rows-unmarked')[0]).toMatchObject({
      testId: '0123456',
      learnerId: 'learner3',
      rowRange: { start: 34, end: 39 },
    });
  });

  it('records the unmarked live record at warn, where production can see it', async () => {
    // The only line this path used to emit was `scan-no-allocation` at DEBUG,
    // and debug never reaches the log store — so four fed sheets left no trace
    // anywhere a person would look.
    const logger = silentLogger();
    const bus = build({ outcome: unmarkedLiveRows(), recorder: duplicateRecorder(), logger });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(logger.warn).toHaveBeenCalledWith(
      'school.print.scan-live-record-unmarked',
      expect.objectContaining({ testId: '0123456' }),
    );
  });

  it('speaks ONCE, not once for the rows and again for the backstop', async () => {
    const bus = build({ outcome: unmarkedLiveRows(), recorder: duplicateRecorder() });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(bus.broadcast.mock.calls.filter(([, p]) => p?.event?.startsWith('scan-'))).toHaveLength(1);
  });

  it('tells a child with a BLANK card what to fill in, not that it was already done', async () => {
    // `scan-not-recorded` reads "Already done — there was nothing new to
    // mark", which is false for a card nobody filled in and points the child
    // away from the one thing they need to do.
    const bus = build({
      outcome: {
        results: [],
        cardRecordCount: 7,
        silentLiveRecords: [{
          recordId: 'civilization/atlas/ws-today@rev1:v0:34-39',
          documentId: 'civilization/atlas/ws-today',
          rowRange: { start: 34, end: 39 },
          learnerId: 'learner3',
        }],
      },
      recorder: duplicateRecorder(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(eventsNamed(bus, 'scan-rows-unmarked')).toHaveLength(1);
    expect(eventsNamed(bus, 'scan-not-recorded')).toHaveLength(0);
  });

  it('stays quiet for a legacy bubble sheet the store has no records for at all', async () => {
    // The deliberate silence this early return was originally written for, and
    // the one case that must survive the fix: a sheet on this bus that was
    // never a print-document at all. The recorder already persisted it.
    const bus = build({
      outcome: { results: [], cardRecordCount: 0, unallocatedRows: [1, 2, 3] },
      recorder: duplicateRecorder(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(bus.broadcast.mock.calls.filter(([, p]) => p?.event?.startsWith('scan-'))).toHaveLength(0);
  });
});

// The structural rule, not another instance of it. Both silent-scan incidents
// (2026-08-25's missing `else`, 2026-08-26's early return above the backstop)
// were the same defect wearing different clothes: a terminal path that exits
// without a ceremony. This table is the guard — every outcome shape
// `ResolveCardScan` can return, asserted to produce exactly one.
describe('createSchoolPrintScanConsumer: every terminal outcome makes exactly one mark on the room', () => {
  const TERMINAL_OUTCOMES = [
    ['an unreadable card id', { error: { code: 'CARD_ID_UNREADABLE' } }],
    ['a card the store has never seen', {
      results: [], unknownCard: true, answeredRowCount: 12, nearMissCardIds: ['0123457'],
    }],
    ['a card whose records are all retired', {
      results: [], deadCard: true, answeredRowCount: 12, recordStatuses: ['released'],
    }],
    ['a live worksheet with blank rows', unmarkedLiveRows()],
    ['a re-fed sheet with nothing new to bank', { results: [card('r1')], cardRecordCount: 1 }],
  ];

  it.each(TERMINAL_OUTCOMES)('speaks for %s', async (_label, outcome) => {
    const bus = build({ outcome, recorder: duplicateRecorder() });
    bus.broadcast('omr', sheetPayload());
    await flush();

    const ceremonies = bus.broadcast.mock.calls.filter(([, p]) => p?.event?.startsWith('scan-'));
    expect(ceremonies).toHaveLength(1);
  });
});

// Final review (2026-08-26): the TERMINAL_OUTCOMES table above is
// structurally blind to these — every row in it is a RESOLVED outcome the
// `.then` branch of `onPayload` gets to see. These four are the holes one
// level up: the outer `.catch`, a synchronous throw the funnel didn't wrap,
// a fire-and-forget hook that doesn't return a promise, and the constructor
// guard that is supposed to make the funnel's own assumptions true.
describe('createSchoolPrintScanConsumer: the funnel itself cannot go silent', () => {
  it('answers a sheet when resolveCardScan.execute REJECTS entirely — the .then branch never runs', async () => {
    const bus = makeBus();
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => { throw new Error('allocation store unreachable'); } },
      recordCardScanOutcome: duplicateRecorder(),
      logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(eventsNamed(bus, 'scan-not-recorded')).toHaveLength(1);
  });

  it('answers a sheet when recordCardScanOutcome.execute throws SYNCHRONOUSLY rather than rejecting', async () => {
    const bus = build({
      records: ['r1'],
      recorder: { execute: () => { throw new Error('sync boom'); } },
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(eventsNamed(bus, 'scan-not-recorded')).toHaveLength(1);
  });

  it('still reaches the scan-rows-unmarked speak when gradingHook.fire returns a non-promise', async () => {
    // Before the fix, `gradingHook?.fire(...).catch(() => {})` called
    // `.catch` on `undefined` and threw SYNCHRONOUSLY, on this exact
    // incident path, above the `scan-rows-unmarked` speak a few lines below
    // it — so the sheet fell through to the generic `scan-not-recorded`
    // backstop (or, before CRITICAL 1a, to nothing at all) instead of the
    // ceremony that actually tells the child which rows to fill in.
    const bus = makeBus();
    createSchoolPrintScanConsumer({
      eventBus: bus,
      resolveCardScan: { execute: async () => unmarkedLiveRows() },
      recordCardScanOutcome: duplicateRecorder(),
      gradingHook: { fire: () => undefined },
      logger: silentLogger(),
    });
    bus.broadcast('omr', sheetPayload());
    await flush();

    expect(eventsNamed(bus, 'scan-rows-unmarked')).toHaveLength(1);
    expect(eventsNamed(bus, 'scan-not-recorded')).toHaveLength(0);
  });

  it('refuses to construct against a subscribe-only bus — broadcast is not optional', () => {
    const subs = new Map();
    const subscribeOnlyBus = {
      subscribe(topic, fn) {
        if (!subs.has(topic)) subs.set(topic, new Set());
        subs.get(topic).add(fn);
        return () => subs.get(topic)?.delete(fn);
      },
      // Deliberately no `broadcast` — the shape the constructor guard used
      // to accept. `spoke` in `speak()` is set BEFORE the broadcast call
      // runs, so handing this consumer a subscribe-only bus used to mark
      // every sheet as answered while broadcasting nothing at all.
    };
    expect(() => createSchoolPrintScanConsumer({
      eventBus: subscribeOnlyBus,
      resolveCardScan: { execute: async () => ({ results: [] }) },
    })).toThrow(/broadcast/);
  });
});
