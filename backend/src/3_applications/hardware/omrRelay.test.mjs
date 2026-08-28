// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { createOmrRelay } from './omrRelay.mjs';
import { YamlDayLogDatastore } from '#adapters/persistence/yaml/YamlDayLogDatastore.mjs';

const NOOP_LOGGER = { warn() {}, info() {}, debug() {}, error() {} };
const READER_ID = 'study-omr';

/**
 * Polls until `predicate()` is truthy. Replaces fixed sleeps, which encode a
 * guess about how long work takes — a guess that is wrong under parallel load
 * and produces a test that is red for reasons unrelated to the code.
 */
async function until(predicate, { timeoutMs = 2000, intervalMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`until(): condition not met within ${timeoutMs}ms`);
    await new Promise((r) => { setTimeout(r, intervalMs); });
  }
}

// Minimal in-memory event bus that routes broadcasts to subscribers
// synchronously — mirroring WebSocketEventBus's producer/subscriber wiring.
function makeBus() {
  const subs = new Map();
  const broadcasts = [];
  let clientHandler = null;
  return {
    broadcasts,
    onClientMessage(fn) { clientHandler = fn; },
    subscribe(topic, fn) {
      if (!subs.has(topic)) subs.set(topic, new Set());
      subs.get(topic).add(fn);
      return () => subs.get(topic)?.delete(fn);
    },
    broadcast(topic, payload) {
      broadcasts.push({ topic, payload });
      for (const fn of subs.get(topic) || []) fn(payload);
    },
    // test helper: simulate the relay device client sending a frame
    emit(message) { clientHandler?.('relay-client', message); },
  };
}

// One card off the firmware's handleFrame(): marks[] is a 12-bit mask per column.
function sheetFrame(marks, id = READER_ID) {
  return {
    source: 'omr-relay',
    type: 'sheet',
    id,
    columns: marks.length,
    markedColumns: marks.filter((m) => m !== 0).length,
    marks,
  };
}

describe('createOmrRelay', () => {
  let dataDir;

  function dayFileFor(id = READER_ID) {
    const day = new Date().toISOString().slice(0, 10);
    return path.join(dataDir, 'omr', id, `${day}.yml`);
  }

  async function readRecords(id = READER_ID) {
    try {
      const parsed = yaml.load(await fs.readFile(dayFileFor(id), 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  // Appends are serialized on an internal promise chain; poll until the file
  // reaches the expected length (or give up and hand back whatever is there,
  // so a failing `expect(...).toHaveLength(n)` reports the real short count
  // rather than an opaque timeout).
  /**
   * Wait for `n` records to land, and FAIL IN WORDS if they do not.
   *
   * This used to swallow `until()`'s timeout and return whatever `readRecords`
   * happened to hold — usually `[]` — so "the write never landed" surfaced
   * several lines later as `TypeError: Cannot read properties of undefined
   * (reading 'ts')` in whichever assertion touched `recs[0]` first. That reads
   * exactly like a bug in the timestamp logic and is nothing of the kind, and
   * it cost real time to chase more than once.
   *
   * The relay writes through async file I/O, so on a loaded machine (several
   * suites running in parallel) the old 2s deadline was genuinely too short —
   * which is why this looked like a deterministic failure to some runs and a
   * clean pass to others. The deadline is generous here for that reason; a
   * miss past it is a real timeout and now says so.
   */
  const RECORD_WAIT_MS = 10_000;

  async function waitForRecords(n, id = READER_ID) {
    try {
      return await until(async () => {
        const recs = await readRecords(id);
        return recs.length >= n ? recs : null;
      }, { timeoutMs: RECORD_WAIT_MS });
    } catch {
      const found = await readRecords(id);
      throw new Error(
        `waitForRecords(${n}) timed out after ${RECORD_WAIT_MS}ms for reader "${id}" — `
        + `${found.length} record(s) on disk. The relay's write had not landed: `
        + 'this is a timeout, not a data bug.',
      );
    }
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omr-test-'));
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  function wire({ timezone = 'UTC', config = {} } = {}) {
    const bus = makeBus();
    createOmrRelay({
      eventBus: bus,
      dataDir,
      // Resolved by the composition root in production; supplied directly here.
      dayLog: new YamlDayLogDatastore({ root: path.join(dataDir, 'omr'), timezone, eventPrefix: 'omr' }),
      config: { ...config },
      timezone,
      logger: NOOP_LOGGER,
    });
    return bus;
  }

  it('re-broadcasts an ingested sheet on the default topic and persists it', async () => {
    const bus = wire();
    bus.emit(sheetFrame([0, 2048, 0, 16]));

    const live = bus.broadcasts.find((b) => b.topic === 'omr');
    expect(live).toBeTruthy();
    expect(live.payload).toMatchObject({ id: READER_ID, event: 'sheet', columns: 4, markedColumns: 2 });
    expect(live.payload.marks).toEqual([0, 2048, 0, 16]);

    const recs = await waitForRecords(1);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ event: 'sheet', columns: 4, markedColumns: 2 });
    expect(recs[0].marks).toEqual([0, 2048, 0, 16]);
  });

  it('honors a per-reader topic override from config', async () => {
    const bus = wire({ config: { scanners: { [READER_ID]: { topic: 'omr-study' } } } });
    bus.emit(sheetFrame([1]));

    expect(bus.broadcasts.some((b) => b.topic === 'omr-study')).toBe(true);
    expect(bus.broadcasts.some((b) => b.topic === 'omr')).toBe(false);

    // The persist subscription still listens on the override topic and queues
    // a write; drain it before the test ends (afterEach fs.rm race — not in
    // the original ~10 sleeps; this test had no wait of any kind before).
    await waitForRecords(1);
  });

  it('derives columns/markedColumns from marks[] rather than trusting the wire', async () => {
    const bus = wire();
    // A truncated frame: the firmware's derived counts disagree with marks[].
    bus.emit({ ...sheetFrame([0, 4, 0]), columns: 99, markedColumns: 99 });

    const recs = await waitForRecords(1);
    expect(recs[0].columns).toBe(3);
    expect(recs[0].markedColumns).toBe(1);
  });

  it('suppresses a retransmit of the same card inside the dedup window', async () => {
    const bus = wire();
    bus.emit(sheetFrame([8, 0, 512]));
    bus.emit(sheetFrame([8, 0, 512])); // reader `R` retransmit, or a re-fed card

    // The dedup decision is made synchronously when the second frame is
    // emitted (see lastSheet in omrRelay.mjs) — only the disk write is async.
    // Poll for exactly 1, not >=1: once observed, no further append is ever
    // scheduled for this pair, so a stale "1" can't hide a later "2".
    const recs = await until(async () => {
      const found = await readRecords();
      return found.length === 1 ? found : null;
    });
    expect(recs).toHaveLength(1);
  });

  it('records a genuinely different card that arrives immediately after', async () => {
    const bus = wire();
    bus.emit(sheetFrame([8, 0, 512]));
    bus.emit(sheetFrame([8, 0, 256])); // one bubble different — a real second card

    const recs = await waitForRecords(2);
    expect(recs).toHaveLength(2);
  });

  it('re-records an identical card once the dedup window has passed', async () => {
    const bus = wire({ config: { persistence: { dir: 'omr', dedupWindowMs: 10 } } });
    bus.emit(sheetFrame([64]));
    await new Promise((r) => setTimeout(r, 25));
    bus.emit(sheetFrame([64]));

    const recs = await waitForRecords(2);
    expect(recs).toHaveLength(2);
  });

  it('persists a blank card — a blank submission is a real event', async () => {
    const bus = wire();
    bus.emit(sheetFrame([0, 0, 0]));

    const recs = await waitForRecords(1);
    expect(recs[0]).toMatchObject({ event: 'sheet', columns: 3, markedColumns: 0 });
  });

  it('broadcasts raw frames for diagnostics but never persists them', async () => {
    const bus = wire();
    bus.emit({ source: 'omr-relay', type: 'raw', id: READER_ID, hex: '2020', len: 2 });

    expect(bus.broadcasts.some((b) => b.payload.event === 'raw')).toBe(true);

    // `raw` is never queued for persistence (see onPayload in omrRelay.mjs), so
    // there is no async write to poll for directly. Drive a distinct,
    // always-persisted sentinel frame through the SAME serialized write chain:
    // appends land in enqueue order, so once the sentinel is on disk, anything
    // the raw frame might have queued would already be there too.
    bus.emit(sheetFrame([2]));
    const recs = await waitForRecords(1);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ event: 'sheet', marks: [2] });
  });

  // ---- NFC taps (optional Grove NFC unit on the same relay) ----------------
  // Values from the bench unit: an ST25R3916 reading an NTAG 215.
  function nfcFrame(uid = '04669C0FCB2A81', over = {}) {
    return {
      source: 'omr-relay', type: 'nfc', id: READER_ID,
      uid, piccType: 'NTAG 215', atqa: 0x0044, sak: 0x00, ...over,
    };
  }

  it('broadcasts and persists an NFC tap', async () => {
    const bus = wire();
    bus.emit(nfcFrame());

    const live = bus.broadcasts.find((b) => b.payload.event === 'nfc');
    expect(live).toBeTruthy();
    expect(live.topic).toBe('omr');
    expect(live.payload).toMatchObject({
      id: READER_ID, event: 'nfc', uid: '04669C0FCB2A81', piccType: 'NTAG 215',
    });

    const recs = await waitForRecords(1);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ event: 'nfc', uid: '04669C0FCB2A81', piccType: 'NTAG 215' });
  });

  it('normalizes a lowercase UID so one card never reads as two students', async () => {
    const bus = wire();
    bus.emit(nfcFrame('04669c0fcb2a81'));
    const live = bus.broadcasts.find((b) => b.payload.event === 'nfc');
    expect(live.payload.uid).toBe('04669C0FCB2A81');

    // The tap also queues a persist write; drain it before the test ends so
    // afterEach's fs.rm on dataDir doesn't race an in-flight append
    // (ENOTEMPTY, observed under load — not in the original ~10 sleeps).
    await waitForRecords(1);
  });

  it('drops a tap with no usable UID rather than broadcasting an unidentifiable one', async () => {
    const bus = wire();
    bus.emit(nfcFrame(''));
    bus.emit(nfcFrame('nonsense'));
    bus.emit({ source: 'omr-relay', type: 'nfc', id: READER_ID });

    expect(bus.broadcasts.filter((b) => b.payload.event === 'nfc')).toHaveLength(0);

    // None of these ever reach eventBus.broadcast (bad-UID rejection happens
    // before that call), so nothing was ever queued to persist. Prove it with
    // a sentinel through the same write chain rather than a blind sleep.
    bus.emit(sheetFrame([4]));
    const recs = await waitForRecords(1);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ event: 'sheet', marks: [4] });
  });

  it('suppresses a repeat of the SAME card inside the dedup window', async () => {
    // A fumbled card can leave and re-enter the field in a moment. That must not
    // start two sessions or print two tests.
    const bus = wire({ config: { persistence: { dir: 'omr', dedupWindowMs: 2000 } } });
    bus.emit(nfcFrame());
    bus.emit(nfcFrame());

    // As with the sheet dedup case, the suppress decision (lastNfc) is made
    // synchronously on the second emit — only the single scheduled write is
    // async. Poll for exactly 1, not >=1.
    const recs = await until(async () => {
      const found = await readRecords();
      return found.length === 1 ? found : null;
    });
    expect(recs).toHaveLength(1);
  });

  it('records a DIFFERENT card tapped immediately after — dedup is per UID', async () => {
    const bus = wire({ config: { persistence: { dir: 'omr', dedupWindowMs: 2000 } } });
    bus.emit(nfcFrame('04669C0FCB2A81'));
    bus.emit(nfcFrame('04AABBCCDDEE01'));
    const recs = await waitForRecords(2);
    expect(recs.map((r) => r.uid)).toEqual(['04669C0FCB2A81', '04AABBCCDDEE01']);
  });

  it('broadcasts one nfc event for a bouncing card, not five', async () => {
    const bus = wire();

    // One physical tap that the reader reported five times in ~100ms —
    // the 2026-08-25 incident, replayed.
    for (let i = 0; i < 5; i += 1) {
      bus.emit({
        source: 'omr-relay', type: 'nfc', id: READER_ID,
        uid: '04DB930CCB2A81', piccType: 'NTAG 215',
      });
    }

    const nfcBroadcasts = bus.broadcasts.filter((b) => b.payload?.event === 'nfc');
    expect(nfcBroadcasts).toHaveLength(1);
    expect(nfcBroadcasts[0].payload.uid).toBe('04DB930CCB2A81');

    // One persist write was queued for the surviving tap; drain it before the
    // test ends (afterEach fs.rm race — not in the original ~10 sleeps).
    await waitForRecords(1);
  });

  it('does not suppress a DIFFERENT card tapped immediately after', async () => {
    const bus = wire();

    bus.emit({ source: 'omr-relay', type: 'nfc', id: READER_ID, uid: '04DB930CCB2A81' });
    bus.emit({ source: 'omr-relay', type: 'nfc', id: READER_ID, uid: '048BA600CC2A81' });

    const uids = bus.broadcasts
      .filter((b) => b.payload?.event === 'nfc')
      .map((b) => b.payload.uid);
    expect(uids).toEqual(['04DB930CCB2A81', '048BA600CC2A81']);

    // Two persist writes were queued (different UIDs, no dedup); drain both
    // before the test ends. This is the exact ENOTEMPTY race reproduced while
    // building this fix: afterEach's fs.rm on dataDir collided with one of
    // these in-flight appends — not in the original ~10 sleeps.
    await waitForRecords(2);
  });

  it('backdates a queued tap by ageMs so it carries the TAP time', async () => {
    const bus = wire({ timezone: 'UTC' });
    bus.emit(nfcFrame('04669C0FCB2A81', { ageMs: 90_000 }));
    const recs = await waitForRecords(1);
    const recorded = new Date(`${recs[0].ts.replace(' ', 'T')}Z`);
    expect(Date.now() - recorded.getTime()).toBeGreaterThan(60_000);
  });

  it('broadcasts and persists a reader-error echo', async () => {
    const bus = wire();
    bus.emit({ source: 'omr-relay', type: 'reader-error', id: READER_ID, echo: '49303F' });

    expect(bus.broadcasts.some((b) => b.payload.event === 'reader-error')).toBe(true);
    const recs = await waitForRecords(1);
    expect(recs[0]).toMatchObject({ event: 'reader-error', echo: '49303F' });
  });

  it('drops frames from a foreign source', async () => {
    const bus = wire();
    bus.emit({ ...sheetFrame([1]), source: 'food-scale-relay' });

    expect(bus.broadcasts).toHaveLength(0);

    // A foreign source is rejected before eventBus.broadcast is ever called,
    // so nothing was queued to persist. Sentinel through the write chain
    // instead of a blind sleep.
    bus.emit(sheetFrame([8]));
    const recs = await waitForRecords(1);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ event: 'sheet', marks: [8] });
  });

  it.each([
    ['empty marks', []],
    ['non-array marks', 'nope'],
    ['a mask wider than 12 bits', [4096]],
    ['a negative mask', [-1]],
    ['a non-integer mask', [1.5]],
  ])('rejects a malformed frame: %s', async (_label, marks) => {
    const bus = wire();
    bus.emit({ source: 'omr-relay', type: 'sheet', id: READER_ID, marks });

    expect(bus.broadcasts).toHaveLength(0);

    // normalizeMarks() rejects before eventBus.broadcast is called, so nothing
    // was ever queued to persist. Sentinel through the write chain instead of
    // a blind sleep; each case gets a fresh dataDir (beforeEach), so a fixed
    // sentinel mark is fine across the table.
    bus.emit(sheetFrame([16]));
    const recs = await waitForRecords(1);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ event: 'sheet', marks: [16] });
  });

  it('keeps each reader in its own history directory', async () => {
    const bus = wire();
    bus.emit(sheetFrame([1], 'study-omr'));
    bus.emit(sheetFrame([1], 'kitchen-omr'));

    expect(await waitForRecords(1, 'study-omr')).toHaveLength(1);
    expect(await waitForRecords(1, 'kitchen-omr')).toHaveLength(1);
  });

  it('dedups per reader, not globally', async () => {
    const bus = wire();
    // Two different readers legitimately produce identical sheets at once.
    bus.emit(sheetFrame([32], 'study-omr'));
    bus.emit(sheetFrame([32], 'kitchen-omr'));

    expect(await waitForRecords(1, 'study-omr')).toHaveLength(1);
    expect(await waitForRecords(1, 'kitchen-omr')).toHaveLength(1);
  });

  it('buckets the day file by LOCAL date, not UTC', async () => {
    const TZ = 'America/Denver';
    const bus = wire({ timezone: TZ });
    bus.emit(sheetFrame([1]));

    // Deliberately NOT via readRecords(): that helper derives the filename from
    // toISOString(), i.e. the UTC day. Using it here made this test — the very
    // one asserting local-vs-UTC bucketing — silently UTC-dependent, so it failed
    // every evening once local and UTC dates diverged. Discover the file instead.
    const dir = path.join(dataDir, 'omr', READER_ID);
    const files = await until(async () => {
      const found = await fs.readdir(dir).catch(() => []);
      return found.length ? found : null;
    });
    expect(files).toHaveLength(1);

    // en-CA renders as YYYY-MM-DD, which is the bucket format.
    const expectedDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    expect(files[0]).toBe(`${expectedDay}.yml`);

    const recs = yaml.load(await fs.readFile(path.join(dir, files[0]), 'utf8'));
    expect(recs[0].ts.slice(0, 10)).toBe(expectedDay);
  });

  // The relay is wired with timezone 'UTC' in these tests, so its `ts` is a
  // UTC wall-clock string with no offset suffix. Parse it as UTC explicitly —
  // letting Date() treat it as local time silently shifts every assertion by
  // the runner's offset.
  const parseTs = (ts) => new Date(`${ts.replace(' ', 'T')}Z`).getTime();

  it('backdates a queued sheet by ageMs so it carries the READ time, not delivery time', async () => {
    const bus = wire();
    // A sheet the relay held for 10 minutes while the bus was down.
    bus.emit({ ...sheetFrame([1]), ageMs: 600_000 });

    const recs = await waitForRecords(1);
    const drift = Math.abs(Date.now() - 600_000 - parseTs(recs[0].ts));
    expect(drift).toBeLessThan(5000); // ~10 min ago, not now
  });

  it('ignores a nonsensical ageMs rather than time-travelling', async () => {
    const bus = wire();
    bus.emit({ ...sheetFrame([1]), ageMs: -5000 });

    const recs = await waitForRecords(1);
    expect(Math.abs(Date.now() - parseTs(recs[0].ts))).toBeLessThan(5000);
  });

  it('records a data-loss event when the relay reports dropped messages', async () => {
    const bus = wire();
    bus.emit({ source: 'omr-relay', type: 'relay-status', id: READER_ID, queued: 3, dropped: 7, truncated: 1 });

    const recs = await waitForRecords(1);
    expect(recs[0]).toMatchObject({ event: 'data-loss', dropped: 7, truncated: 1, queued: 3 });
  });

  it('does not record a clean relay-status — a reconnect is not an event', async () => {
    const bus = wire();
    bus.emit({ source: 'omr-relay', type: 'relay-status', id: READER_ID, queued: 2, dropped: 0, truncated: 0 });

    expect(bus.broadcasts.some((b) => b.payload.event === 'relay-status')).toBe(true);

    // onPayload only enqueues a relay-status when dropped/truncated > 0, so
    // nothing was queued here. Sentinel through the write chain instead of a
    // blind sleep.
    bus.emit(sheetFrame([32]));
    const recs = await waitForRecords(1);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ event: 'sheet', marks: [32] });
  });

  it('requires an event bus with onClientMessage + subscribe', () => {
    expect(() => createOmrRelay({ eventBus: {}, dataDir })).toThrow(/eventBus/);
  });

  it('stops persisting after dispose()', async () => {
    const bus = makeBus();
    const relay = createOmrRelay({
      eventBus: bus, dataDir, config: { persistence: { dir: 'omr' } }, timezone: 'UTC', logger: NOOP_LOGGER,
    });
    relay.dispose();
    bus.emit(sheetFrame([1]));

    // Unlike the other "never persisted" cases, there is no later sentinel to
    // wait for: dispose() removes the persist subscription for good (see
    // `unsubs` in omrRelay.mjs), so this relay instance will never queue
    // another write. Nothing to poll for — and nothing to race, either: the
    // test bus's ingest -> broadcast -> subscriber fan-out (makeBus above) is
    // fully synchronous, so the decision not to persist is already final by
    // the time emit() returns.
    expect(await readRecords()).toHaveLength(0);
  });
});
