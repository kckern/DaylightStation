import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCadenceGate } from '../src/cadenceGate.mjs';

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
