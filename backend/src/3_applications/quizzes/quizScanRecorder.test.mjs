// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { decodeQuizSheet, createQuizScanRecorder, rebuildQuizDayFiles } from './quizScanRecorder.mjs';

const NOOP_LOGGER = { warn() {}, info() {}, debug() {}, error() {} };
const READER_ID = 'study-omr';

// The calibration sheet scanned 2026-07-30 21:16:43 — the card that pinned the
// form layout. Test ID 0123456; Q1–9 = A B C D E D C B A; Q15 double-marked A+E;
// Q26–34 = C B C B C C E D A; Q40 = C.
const CALIBRATION_MARKS = [
  512, 256, 128, 64, 32, 16, 8,          // test ID 0123456
  1028, 520, 260, 136, 68, 132, 257, 514, 1040, // Q1-9 paired with Q26-34
  0, 0, 0, 0, 0,
  1092,                                   // Q15 = A+E, Q40 = C
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
      for (const fn of subs.get(topic) || []) fn(payload);
    },
  };
}

function sheetPayload(marks, ts = '2026-07-30 21:16:43', id = READER_ID) {
  return {
    id,
    event: 'sheet',
    columns: marks.length,
    markedColumns: marks.filter((m) => m !== 0).length,
    marks,
    ts,
    source: 'omr-relay',
  };
}

describe('decodeQuizSheet', () => {
  it('decodes the 2026-07-30 calibration sheet exactly', () => {
    const decoded = decodeQuizSheet(CALIBRATION_MARKS);
    expect(decoded.testId).toBe('0123456');
    expect(decoded.answers).toEqual({
      1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E', 6: 'D', 7: 'C', 8: 'B', 9: 'A',
      15: ['A', 'E'],
      26: 'C', 27: 'B', 28: 'C', 29: 'B', 30: 'C', 31: 'C', 32: 'E', 33: 'D', 34: 'A',
      40: 'C',
    });
  });

  it('omits unanswered questions entirely', () => {
    const marks = new Array(32).fill(0);
    marks[7] = 1 << 10; // Q1 = A only
    const decoded = decodeQuizSheet(marks);
    expect(decoded.answers).toEqual({ 1: 'A' });
    expect(decoded.testId).toBeNull(); // all ID columns blank
  });

  it('marks unreadable test-ID digits with ? (blank or double-marked)', () => {
    const marks = new Array(32).fill(0);
    marks[0] = 1 << 9;              // digit 0
    marks[1] = (1 << 9) | (1 << 8); // double mark → ?
    marks[2] = 1 << 7;              // digit 2
    // cols 4-7 blank → ? each, but at least one digit marked so ID is kept
    const decoded = decodeQuizSheet(marks);
    expect(decoded.testId).toBe('0?2????');
  });

  it('carries testIdCandidates alongside an ambiguous id — the actual marks per column, not a re-guess', () => {
    const marks = new Array(32).fill(0);
    marks[0] = 1 << 9;              // digit 0, clean
    marks[1] = (1 << 9) | (1 << 8); // digits 0+1 double-marked → ?
    marks[2] = 1 << 7;              // digit 2, clean
    marks[3] = 1 << 6;              // digit 3, clean
    marks[4] = 0;                   // blank → ?
    marks[5] = 1 << 4;              // digit 5, clean
    marks[6] = 1 << 3;              // digit 6, clean
    const decoded = decodeQuizSheet(marks);
    expect(decoded.testId).toBe('0?23?56');
    // A double-marked column carries the digits actually hit (a real, small
    // candidate set); a blank column carries nothing at all (unconstrained).
    // Clean columns carry their own single digit, redundant with `testId`
    // but harmless — the matcher only ever consults a '?' position.
    expect(decoded.testIdCandidates).toEqual([[0], [0, 1], [2], [3], [], [5], [6]]);
  });

  it('omits testIdCandidates entirely for a cleanly-decoded id — no bloat on the common case', () => {
    const decoded = decodeQuizSheet(CALIBRATION_MARKS);
    expect(decoded.testId).toBe('0123456');
    expect(decoded.testIdCandidates).toBeUndefined();
  });

  it('omits testIdCandidates for a fully blank id (testId null) — nothing for a matcher to do with it', () => {
    const marks = new Array(32).fill(0);
    const decoded = decodeQuizSheet(marks);
    expect(decoded.testId).toBeNull();
    expect(decoded.testIdCandidates).toBeUndefined();
  });

  it('ignores marks on the unused label rows (bits 5 and 11)', () => {
    const marks = new Array(32).fill(0);
    marks[7] = (1 << 11) | (1 << 5) | (1 << 9); // stray label-row ink + Q1=B
    const decoded = decodeQuizSheet(marks);
    expect(decoded.answers).toEqual({ 1: 'B' });
  });

  it('decodes short frames (fewer than 32 columns) without throwing', () => {
    const decoded = decodeQuizSheet([512, 256, 128, 64, 32, 16, 8, 1024]);
    expect(decoded.testId).toBe('0123456');
    expect(decoded.answers).toEqual({ 1: 'A' });
  });
});

// Both entry points take their roots EXPLICITLY (`outRoot`, and `historyRoot`
// for the rebuild) rather than deriving them from `dataDir`. This test used to
// pass `dataDir` alone and read back from a hard-coded
// `household/apps/quizzes/<reader>/`; when the quizzes tree moved under
// `school/records/assessments/omr` the callers were updated and the roots
// became parameters, so every spec here threw "outRoot required" — invisible,
// because backend/ was outside the vitest gate's population at the time. The
// roots are named here the way `app.mjs` and `cli/school/omr.mjs` name them,
// so the fixture cannot drift from the shape production passes again.
describe('createQuizScanRecorder', () => {
  let dataDir;
  let outRoot;
  let bus;
  let recorder;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quiz-scan-'));
    outRoot = path.join(dataDir, 'household', 'school', 'records', 'assessments', 'omr');
    bus = makeBus();
  });

  afterEach(async () => {
    recorder?.dispose();
    recorder = null;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  function start(config = {}) {
    recorder = createQuizScanRecorder({ eventBus: bus, dataDir, outRoot, config, logger: NOOP_LOGGER });
  }

  async function readDay(day = '2026-07-30', id = READER_ID) {
    const file = path.join(outRoot, id, `${day}.yml`);
    const parsed = yaml.load(await fs.readFile(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  }

  async function flush() {
    // appends are serialized on a promise chain; yield until it drains
    await new Promise((r) => setTimeout(r, 25));
  }

  it('decodes a broadcast sheet into the quizzes day file', async () => {
    start();
    bus.broadcast('omr', sheetPayload(CALIBRATION_MARKS));
    await flush();
    const records = await readDay();
    expect(records).toHaveLength(1);
    expect(records[0].ts).toBe('2026-07-30 21:16:43');
    expect(records[0].testId).toBe('0123456');
    expect(records[0].answers[15]).toEqual(['A', 'E']);
    expect(records[0].answers[40]).toBe('C');
  });

  it('day file uses plain numeric question keys, not quoted strings', async () => {
    start();
    bus.broadcast('omr', sheetPayload(CALIBRATION_MARKS));
    await flush();
    const file = path.join(outRoot, READER_ID, '2026-07-30.yml');
    const text = await fs.readFile(file, 'utf8');
    expect(text).toMatch(/^\s+1: A$/m);
    expect(text).not.toMatch(/'1'/);
  });

  it('suppresses an identical retransmit inside the dedup window', async () => {
    start();
    bus.broadcast('omr', sheetPayload(CALIBRATION_MARKS));
    bus.broadcast('omr', sheetPayload(CALIBRATION_MARKS, '2026-07-30 21:16:44'));
    await flush();
    expect(await readDay()).toHaveLength(1);
  });

  it('ignores nfc and other non-sheet events', async () => {
    start();
    bus.broadcast('omr', { id: READER_ID, event: 'nfc', uid: '04669C0FCB2A81', ts: '2026-07-30 21:16:43' });
    await flush();
    await expect(readDay()).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('appends successive distinct sheets in order', async () => {
    start();
    const other = [...CALIBRATION_MARKS];
    other[7] = 1 << 9; // Q1=B instead of A
    bus.broadcast('omr', sheetPayload(CALIBRATION_MARKS, '2026-07-30 21:16:43'));
    bus.broadcast('omr', sheetPayload(other, '2026-07-30 21:17:10'));
    await flush();
    const records = await readDay();
    expect(records).toHaveLength(2);
    expect(records[1].answers[1]).toBe('B');
  });
});

describe('rebuildQuizDayFiles', () => {
  let dataDir;
  let historyRoot;
  let outRoot;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quiz-backfill-'));
    // The same two roots `cli/school/omr.mjs` resolves — raw byte-faithful
    // manifests in, decoded day files out. They are deliberately different
    // trees; a rebuild that wrote back over its own input would be untestable
    // for idempotence.
    historyRoot = path.join(dataDir, 'household', 'hardware', 'omr', 'log');
    outRoot = path.join(dataDir, 'household', 'school', 'records', 'assessments', 'omr');
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('rebuilds decoded day files from the raw manifest, skipping non-sheet events', async () => {
    const historyDir = path.join(historyRoot, READER_ID);
    await fs.mkdir(historyDir, { recursive: true });
    const manifest = [
      { ts: '2026-07-30 20:51:35', event: 'nfc', uid: '04669C0FCB2A81', piccType: 'NTAG 215' },
      { ts: '2026-07-30 21:16:43', event: 'sheet', columns: 32, markedColumns: 17, marks: CALIBRATION_MARKS },
    ];
    await fs.writeFile(path.join(historyDir, '2026-07-30.yml'), yaml.dump(manifest), 'utf8');

    const result = await rebuildQuizDayFiles({ historyRoot, outRoot, config: {}, logger: NOOP_LOGGER });
    expect(result.sheets).toBe(1);

    const out = path.join(outRoot, READER_ID, '2026-07-30.yml');
    const records = yaml.load(await fs.readFile(out, 'utf8'));
    expect(records).toHaveLength(1);
    expect(records[0].testId).toBe('0123456');
    expect(records[0].answers[30]).toBe('C');
  });

  it('is idempotent — rebuilding twice does not duplicate records', async () => {
    const historyDir = path.join(historyRoot, READER_ID);
    await fs.mkdir(historyDir, { recursive: true });
    await fs.writeFile(
      path.join(historyDir, '2026-07-30.yml'),
      yaml.dump([{ ts: '2026-07-30 21:16:43', event: 'sheet', columns: 32, markedColumns: 17, marks: CALIBRATION_MARKS }]),
      'utf8',
    );
    await rebuildQuizDayFiles({ historyRoot, outRoot, config: {}, logger: NOOP_LOGGER });
    await rebuildQuizDayFiles({ historyRoot, outRoot, config: {}, logger: NOOP_LOGGER });
    const out = path.join(outRoot, READER_ID, '2026-07-30.yml');
    expect(yaml.load(await fs.readFile(out, 'utf8'))).toHaveLength(1);
  });
});
