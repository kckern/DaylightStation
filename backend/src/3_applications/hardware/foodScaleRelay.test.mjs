// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { createFoodScaleRelay } from './foodScaleRelay.mjs';

const NOOP_LOGGER = { warn() {}, info() {}, debug() {}, error() {} };
const SCALE_ID = 'kitchen';

// Minimal in-memory event bus that routes broadcasts to subscribers
// synchronously — mirroring WebSocketEventBus's producer/subscriber wiring.
function makeBus() {
  const subs = new Map();
  let clientHandler = null;
  return {
    onClientMessage(fn) { clientHandler = fn; },
    subscribe(topic, fn) {
      if (!subs.has(topic)) subs.set(topic, new Set());
      subs.get(topic).add(fn);
      return () => subs.get(topic)?.delete(fn);
    },
    broadcast(topic, payload) { for (const fn of subs.get(topic) || []) fn(payload); },
    // test helper: simulate the relay device client sending a frame
    emit(message) { clientHandler?.('relay-client', message); },
  };
}

function scaleFrame(grams, stable, unit = 'g') {
  return { source: 'food-scale-relay', type: 'scale', id: SCALE_ID, grams, stable, unit };
}
function buttonFrame(press = 'short') {
  return { source: 'food-scale-relay', type: 'button', id: SCALE_ID, press };
}

describe('createFoodScaleRelay persistence', () => {
  let dataDir;
  let dayFile;

  async function readRecords() {
    try {
      const parsed = yaml.load(await fs.readFile(dayFile, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  // Appends are serialized on an internal promise chain; drain the microtask/
  // timer queue until the file reaches the expected length (or give up).
  async function waitForRecords(n) {
    for (let i = 0; i < 50; i++) {
      const recs = await readRecords();
      if (recs.length >= n) return recs;
      await new Promise((r) => setTimeout(r, 5));
    }
    return readRecords();
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'foodscale-test-'));
    const day = new Date().toISOString().slice(0, 10);
    dayFile = path.join(dataDir, 'nutrition', SCALE_ID, `${day}.yml`);
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  function wire() {
    const bus = makeBus();
    createFoodScaleRelay({
      eventBus: bus,
      dataDir,
      config: { persistence: { dir: 'nutrition' } },
      logger: NOOP_LOGGER,
    });
    return bus;
  }

  it('force-captures the latest reading on a button press, even if not settled', async () => {
    const bus = wire();
    // A live but NOT-yet-settled weight, then the user presses the button to
    // capture it in the moment.
    bus.emit(scaleFrame(250, false, 'g'));
    bus.emit(buttonFrame('short'));

    const recs = await waitForRecords(1);
    const btn = recs.find((r) => r.event === 'button');
    expect(btn).toBeTruthy();
    expect(btn.grams).toBe(250);       // captured the live weight
    expect(btn.unit).toBe('g');
  });

  it('does not re-record a held value when transient non-stable frames arrive (shelf rest)', async () => {
    const bus = wire();
    // Scale resting on its side on the shelf: a steady stable load, punctuated
    // by transient non-stable frames from BLE reconnect churn.
    bus.emit(scaleFrame(495, true, 'g'));   // settle → recorded once
    bus.emit(scaleFrame(495, false, 'g'));  // reconnect blip (still ~495)
    bus.emit(scaleFrame(495, true, 'g'));   // re-settle at same value
    bus.emit(scaleFrame(495, false, 'g'));
    bus.emit(scaleFrame(495, true, 'g'));

    // Give the write chain a chance to flush any (erroneous) extra records.
    await new Promise((r) => setTimeout(r, 40));
    const recs = await readRecords();
    const settled = recs.filter((r) => r.kind === 'settled');
    expect(settled.length).toBe(1);
    expect(settled[0].grams).toBe(495);
  });

  it('records distinct settled values and identical values seen after emptying', async () => {
    const bus = wire();
    bus.emit(scaleFrame(200, true, 'g'));   // recorded
    bus.emit(scaleFrame(300, false, 'g'));  // changing
    bus.emit(scaleFrame(350, true, 'g'));   // distinct → recorded
    bus.emit(scaleFrame(0, true, 'g'));     // pan emptied → re-arm
    bus.emit(scaleFrame(200, true, 'g'));   // same as first, but new session → recorded

    const recs = await waitForRecords(3);
    const settled = recs.filter((r) => r.kind === 'settled').map((r) => r.grams);
    expect(settled).toEqual([200, 350, 200]);
  });
});
