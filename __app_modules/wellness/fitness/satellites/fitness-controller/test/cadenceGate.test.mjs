import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCadenceGate } from "../src/cadenceGate.mjs";

test('passes cadence through while revolutions advance', () => {
  const g = createCadenceGate({ revStaleMs: 2500 });
  assert.equal(g.gate('7153', { calculatedCadence: 110, revolutionCount: 10, now: 0 }), 110);
  assert.equal(g.gate('7153', { calculatedCadence: 110, revolutionCount: 12, now: 1000 }), 110);
  assert.equal(g.gate('7153', { calculatedCadence: 110, revolutionCount: 14, now: 2000 }), 110);
});

test('holds cadence while revolutions are briefly unchanged (within window)', () => {
  const g = createCadenceGate({ revStaleMs: 2500 });
  g.gate('7153', { calculatedCadence: 110, revolutionCount: 14, now: 0 });
  // Same rev count 2s later — still within the 2500ms window → keep 110.
  assert.equal(g.gate('7153', { calculatedCadence: 110, revolutionCount: 14, now: 2000 }), 110);
});

test('zeros a stuck cadence once revolutions stall past the window', () => {
  const g = createCadenceGate({ revStaleMs: 2500 });
  g.gate('7153', { calculatedCadence: 110, revolutionCount: 14, now: 0 });
  // Sensor keeps sending CAD:110 but rev count never advances → after 2.5s → 0.
  assert.equal(g.gate('7153', { calculatedCadence: 110, revolutionCount: 14, now: 2600 }), 0);
  assert.equal(g.gate('7153', { calculatedCadence: 110, revolutionCount: 14, now: 5000 }), 0);
});

test('resumes real cadence when revolutions advance again after a stall', () => {
  const g = createCadenceGate({ revStaleMs: 2500 });
  g.gate('7153', { calculatedCadence: 110, revolutionCount: 14, now: 0 });
  assert.equal(g.gate('7153', { calculatedCadence: 110, revolutionCount: 14, now: 3000 }), 0); // stalled
  assert.equal(g.gate('7153', { calculatedCadence: 95, revolutionCount: 15, now: 3500 }), 95); // moving again
});

test('passes cadence through unchanged when no revolution count is available', () => {
  const g = createCadenceGate({ revStaleMs: 2500 });
  assert.equal(g.gate('hr1', { calculatedCadence: 110, revolutionCount: null, now: 0 }), 110);
  assert.equal(g.gate('hr1', { calculatedCadence: 110, revolutionCount: undefined, now: 9000 }), 110);
});

test('returns null when there is no cadence', () => {
  const g = createCadenceGate({ revStaleMs: 2500 });
  assert.equal(g.gate('7153', { calculatedCadence: null, revolutionCount: 14, now: 0 }), null);
});

test('handles the 16-bit revolution-count wrap as advancement (not a stall)', () => {
  const g = createCadenceGate({ revStaleMs: 2500 });
  g.gate('7153', { calculatedCadence: 100, revolutionCount: 65535, now: 0 });
  // Wrap: 65535 -> 3 is a change → treated as advancing → cadence passes, timer resets.
  assert.equal(g.gate('7153', { calculatedCadence: 100, revolutionCount: 3, now: 3000 }), 100);
});

test('tracks devices independently', () => {
  const g = createCadenceGate({ revStaleMs: 2500 });
  g.gate('a', { calculatedCadence: 110, revolutionCount: 14, now: 0 });
  g.gate('b', { calculatedCadence: 80, revolutionCount: 200, now: 0 });
  // a stalls, b advances.
  assert.equal(g.gate('a', { calculatedCadence: 110, revolutionCount: 14, now: 3000 }), 0);
  assert.equal(g.gate('b', { calculatedCadence: 80, revolutionCount: 205, now: 3000 }), 80);
});

for (const rpm of [15, 20]) {
  test(`keeps continuous ${rpm} RPM readings between complete turns, then detects a stop`, () => {
    const g = createCadenceGate();
    const period = 60000 / rpm;
    for (let now = 0; now <= 20000; now += 250) {
      assert.equal(g.gate('slow', { calculatedCadence: rpm, revolutionCount: Math.floor(now / period), now }), rpm, `false stop at ${now}ms`);
    }
    assert.equal(g.gate('slow', { calculatedCadence: rpm, revolutionCount: Math.floor(20000 / period), now: 27000 }), 0);
  });
}

test('accepts slowing from fast to slow and low-cadence counter rollover', () => {
  const g = createCadenceGate();
  g.gate('slow', { calculatedCadence: 60, revolutionCount: 65535, now: 0 });
  assert.equal(g.gate('slow', { calculatedCadence: 60, revolutionCount: 65535, now: 3500 }), 60);
  assert.equal(g.gate('slow', { calculatedCadence: 15, revolutionCount: 0, now: 4000 }), 15);
  assert.equal(g.gate('slow', { calculatedCadence: 15, revolutionCount: 0, now: 7750 }), 15);
});

test('bounds a stale tiny cadence so it cannot hold the bike moving forever', () => {
  const g = createCadenceGate();
  g.gate('slow', { calculatedCadence: 1, revolutionCount: 1, now: 0 });
  assert.equal(g.gate('slow', { calculatedCadence: 1, revolutionCount: 1, now: 6250 }), 0);
});
