import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHrSpikeGate, SPIKE_MAX_DELTA_BPM, SPIKE_WINDOW_MS } from '../src/hrSpikeGate.mjs';

// 2026-10-23: straps strap-a1 and strap-b1 each broadcast ONE ComputedHeartRate=204
// packet mid-steady-reading. The beat gate passed it (BeatCount advanced) and
// the 50-230 range check passed it; the app celebrated Fire twice.
const run = (gate, id, values, step = 250) => values.map((hr, i) => gate.gate(id, { heartRate: hr, now: 1000 + i * step }));

test('limits match the browser slew gate', () => {
  assert.equal(SPIKE_MAX_DELTA_BPM, 25);
  assert.equal(SPIKE_WINDOW_MS, 2000);
});

test('Rider A 152,152,204,153: the 204 never leaves the bridge', () => {
  const out = run(createHrSpikeGate(), 'strap-a1', [152, 152, 204, 153, 153]);
  assert.deepEqual(out.map((r) => r.hr), [152, 152, null, 153, 153]);
  assert.deepEqual(out.map((r) => r.verdict), ['accept', 'accept', 'held', 'rejected', 'accept']);
  assert.equal(out[2].heldHr, 204);
  assert.equal(out[2].previousHr, 152);
  assert.equal(out[3].heldHr, 204);
});

test('Rider B 111,204,110: held then rejected', () => {
  const out = run(createHrSpikeGate(), 'strap-b1', [111, 204, 110]);
  assert.deepEqual(out.map((r) => r.hr), [111, null, 110]);
});

test('a real jump is confirmed by the next packet', () => {
  const out = run(createHrSpikeGate(), 's', [100, 140, 141]);
  assert.deepEqual(out.map((r) => r.verdict), ['accept', 'held', 'confirmed']);
  assert.equal(out[2].hr, 141);
});

test('a genuine climb at 3 bpm/s is never held', () => {
  const values = Array.from({ length: 40 }, (_, i) => 120 + Math.round(i * 0.75));
  assert.ok(run(createHrSpikeGate(), 's', values).every((r) => r.verdict === 'accept'));
});

test('a reading older than the window is not compared, and null resets the baseline', () => {
  const gate = createHrSpikeGate();
  gate.gate('s', { heartRate: 100, now: 0 });
  assert.equal(gate.gate('s', { heartRate: 170, now: SPIKE_WINDOW_MS + 1 }).verdict, 'accept');
  gate.gate('s', { heartRate: null, now: SPIKE_WINDOW_MS + 100 });
  assert.equal(gate.gate('s', { heartRate: 90, now: SPIKE_WINDOW_MS + 200 }).verdict, 'accept');
});

// Garage has two ANT+ dongles; each hears every broadcast, so every packet
// reaches the gate twice (same BeatCount) before the multi-dongle dedup.
test('two dongles: the second copy of a spike packet cannot confirm it', () => {
  const g = createHrSpikeGate();
  const seq = [[152, 10], [152, 10], [152, 11], [152, 11], [204, 12], [204, 12], [153, 13], [153, 13]];
  const out = seq.map(([hr, beat], i) => g.gate('strap-a1', { heartRate: hr, beatCount: beat, now: 1000 + i * 10 }));
  assert.deepEqual(out.map((r) => r.hr), [152, 152, 152, 152, null, null, 153, 153]);
  assert.deepEqual(out.slice(4, 7).map((r) => r.verdict), ['held', 'duplicate', 'rejected']);
});

test('two dongles: a real jump is still confirmed by the next beat', () => {
  const g = createHrSpikeGate();
  const seq = [[100, 1], [100, 1], [140, 2], [140, 2], [141, 3]];
  const out = seq.map(([hr, beat], i) => g.gate('s', { heartRate: hr, beatCount: beat, now: 1000 + i * 10 }));
  assert.deepEqual(out.map((r) => r.verdict), ['accept', 'accept', 'held', 'duplicate', 'confirmed']);
});

test('a range-rejected reading does not clear the baseline', () => {
  const g = createHrSpikeGate();
  g.gate('s', { heartRate: 150, now: 1000 });
  assert.equal(g.gate('s', { heartRate: null, rangeRejected: true, now: 1250 }).verdict, 'none');
  assert.equal(g.gate('s', { heartRate: 204, now: 1500 }).verdict, 'held');
});
