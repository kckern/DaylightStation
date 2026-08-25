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

  // Appends are serialized on an internal promise chain; drain the microtask/
  // timer queue until the file reaches the expected length (or give up).
  async function waitForRecords(n, id = READER_ID) {
    for (let i = 0; i < 50; i++) {
      const recs = await readRecords(id);
      if (recs.length >= n) return recs;
      await new Promise((r) => setTimeout(r, 5));
    }
    return readRecords(id);
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

  it('honors a per-reader topic override from config', () => {
    const bus = wire({ config: { scanners: { [READER_ID]: { topic: 'omr-study' } } } });
    bus.emit(sheetFrame([1]));

    expect(bus.broadcasts.some((b) => b.topic === 'omr-study')).toBe(true);
    expect(bus.broadcasts.some((b) => b.topic === 'omr')).toBe(false);
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

    await new Promise((r) => setTimeout(r, 40));
    const recs = await readRecords();
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
    await new Promise((r) => setTimeout(r, 40));
    expect(await readRecords()).toHaveLength(0);
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
  });

  it('drops a tap with no usable UID rather than broadcasting an unidentifiable one', async () => {
    const bus = wire();
    bus.emit(nfcFrame(''));
    bus.emit(nfcFrame('nonsense'));
    bus.emit({ source: 'omr-relay', type: 'nfc', id: READER_ID });

    expect(bus.broadcasts.filter((b) => b.payload.event === 'nfc')).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 40));
    expect(await readRecords()).toHaveLength(0);
  });

  it('suppresses a repeat of the SAME card inside the dedup window', async () => {
    // A fumbled card can leave and re-enter the field in a moment. That must not
    // start two sessions or print two tests.
    const bus = wire({ config: { persistence: { dir: 'omr', dedupWindowMs: 2000 } } });
    bus.emit(nfcFrame());
    bus.emit(nfcFrame());
    await new Promise((r) => setTimeout(r, 40));
    expect(await readRecords()).toHaveLength(1);
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
  });

  it('does not suppress a DIFFERENT card tapped immediately after', async () => {
    const bus = wire();

    bus.emit({ source: 'omr-relay', type: 'nfc', id: READER_ID, uid: '04DB930CCB2A81' });
    bus.emit({ source: 'omr-relay', type: 'nfc', id: READER_ID, uid: '048BA600CC2A81' });

    const uids = bus.broadcasts
      .filter((b) => b.payload?.event === 'nfc')
      .map((b) => b.payload.uid);
    expect(uids).toEqual(['04DB930CCB2A81', '048BA600CC2A81']);
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
    await new Promise((r) => setTimeout(r, 40));
    expect(await readRecords()).toHaveLength(0);
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
    await new Promise((r) => setTimeout(r, 40));
    expect(await readRecords()).toHaveLength(0);
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
    let files = [];
    for (let i = 0; i < 50; i++) {
      files = await fs.readdir(dir).catch(() => []);
      if (files.length) break;
      await new Promise((r) => setTimeout(r, 5));
    }
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
    await new Promise((r) => setTimeout(r, 40));
    expect(await readRecords()).toHaveLength(0);
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

    await new Promise((r) => setTimeout(r, 40));
    expect(await readRecords()).toHaveLength(0);
  });
});
