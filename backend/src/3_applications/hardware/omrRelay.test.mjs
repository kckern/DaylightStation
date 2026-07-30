// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { createOmrRelay } from './omrRelay.mjs';

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
      config: { persistence: { dir: 'omr' }, ...config },
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
    const bus = wire({ timezone: 'America/Denver' });
    bus.emit(sheetFrame([1]));

    const recs = await waitForRecords(1);
    // The record's ts is local wall-clock; the file it landed in is that ts's day.
    const localDay = recs[0].ts.slice(0, 10);
    const file = path.join(dataDir, 'omr', READER_ID, `${localDay}.yml`);
    await expect(fs.access(file)).resolves.toBeUndefined();
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
