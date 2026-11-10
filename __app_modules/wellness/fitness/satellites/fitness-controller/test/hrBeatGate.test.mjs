import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHrBeatGate, WAKE_SILENCE_MS, BEAT_FROZEN_MS, WAKE_ADVANCES_REQUIRED } from '../src/hrBeatGate.mjs';
import { BleHeartRateDecoder } from '../src/decoders/heart_rate.mjs';

const hrOf = (r) => r.hr;

test('thresholds are named constants with the intended values', () => {
  assert.equal(WAKE_SILENCE_MS, 5000);
  assert.equal(BEAT_FROZEN_MS, 3000);
  assert.equal(WAKE_ADVANCES_REQUIRED, 2);
});

test('wake-up replay: pre-sleep 161 then zeros on a frozen beat count stay null until the count advances twice', () => {
  const g = createHrBeatGate();
  const id = 'strap-a';
  // First packet after the strap wakes: replays its pre-sleep HR on a frozen beat count.
  assert.equal(hrOf(g.gate(id, { heartRate: 161, beatCount: 40, beatTime: 1000, now: 0 })), null);
  assert.equal(hrOf(g.gate(id, { heartRate: 161, beatCount: 40, beatTime: 1000, now: 250 })), null);
  // Then ~16s of zeros, beat count still frozen.
  for (let t = 500; t <= 16500; t += 250) {
    assert.equal(hrOf(g.gate(id, { heartRate: 0, beatCount: 40, beatTime: 1000, now: t })), null, `t=${t}`);
  }
  // First genuine beat — one advance is not enough.
  assert.equal(hrOf(g.gate(id, { heartRate: 75, beatCount: 41, beatTime: 2000, now: 16750 })), null);
  assert.equal(hrOf(g.gate(id, { heartRate: 75, beatCount: 41, beatTime: 2000, now: 17000 })), null);
  // Second genuine beat opens the gate and reports how long it waited.
  const opened = g.gate(id, { heartRate: 90, beatCount: 42, beatTime: 2900, now: 17500 });
  assert.equal(opened.hr, 90);
  assert.equal(opened.openedAfterMs, 17500);
  // Subsequent packets pass and do not re-report opening.
  const next = g.gate(id, { heartRate: 92, beatCount: 42, beatTime: 2900, now: 17750 });
  assert.equal(next.hr, 92);
  assert.equal(next.openedAfterMs, undefined);
});

test('a strap silent longer than the wake window re-closes the gate on return', () => {
  const g = createHrBeatGate();
  const id = 'strap-b';
  g.gate(id, { heartRate: 120, beatCount: 1, beatTime: 0, now: 0 });
  g.gate(id, { heartRate: 120, beatCount: 2, beatTime: 500, now: 500 });
  assert.equal(hrOf(g.gate(id, { heartRate: 130, beatCount: 3, beatTime: 1000, now: 1000 })), 130);
  // Three hours of sleep, then the replay.
  const wake = 3 * 3600 * 1000;
  assert.equal(hrOf(g.gate(id, { heartRate: 161, beatCount: 3, beatTime: 1000, now: wake })), null);
  assert.equal(hrOf(g.gate(id, { heartRate: 100, beatCount: 4, beatTime: 1800, now: wake + 800 })), null);
  const r = g.gate(id, { heartRate: 100, beatCount: 5, beatTime: 2600, now: wake + 1600 });
  assert.equal(r.hr, 100);
  assert.equal(r.openedAfterMs, 1600);
});

test('frozen beat count mid-stream reports null after 3s, resumes when beats advance', () => {
  const g = createHrBeatGate();
  const id = 'strap-c';
  let count = 10;
  for (let t = 0; t <= 2000; t += 500) g.gate(id, { heartRate: 140, beatCount: count++, beatTime: t, now: t });
  // Count freezes at its last value (count - 1); packets keep arriving.
  const frozen = count - 1;
  assert.equal(hrOf(g.gate(id, { heartRate: 140, beatCount: frozen, beatTime: 2000, now: 4000 })), 140); // 2s: within window
  assert.equal(hrOf(g.gate(id, { heartRate: 140, beatCount: frozen, beatTime: 2000, now: 5001 })), null); // >3s
  assert.equal(hrOf(g.gate(id, { heartRate: 140, beatCount: frozen, beatTime: 2000, now: 7000 })), null);
  assert.equal(hrOf(g.gate(id, { heartRate: 138, beatCount: frozen + 1, beatTime: 7000, now: 7250 })), 138);
});

test('8-bit wrap: 255 -> 0 -> 1 counts as advancing', () => {
  const g = createHrBeatGate();
  const id = 'strap-d';
  assert.equal(hrOf(g.gate(id, { heartRate: 150, beatCount: 255, beatTime: 65000, now: 0 })), null);
  assert.equal(hrOf(g.gate(id, { heartRate: 150, beatCount: 0, beatTime: 65400, now: 400 })), null);
  assert.equal(hrOf(g.gate(id, { heartRate: 150, beatCount: 1, beatTime: 264, now: 800 })), 150); // beatTime wrapped too
  assert.equal(hrOf(g.gate(id, { heartRate: 151, beatCount: 2, beatTime: 664, now: 1200 })), 151);
});

test('normal streaming passes values through once open', () => {
  const g = createHrBeatGate();
  const id = 'normal';
  const out = [];
  let beat = 100;
  let bt = 0;
  for (let t = 0; t <= 10000; t += 250) {
    if (t % 500 === 0) { beat = (beat + 1) % 256; bt = (bt + 512) % 65536; }
    out.push(hrOf(g.gate(id, { heartRate: 120, beatCount: beat, beatTime: bt, now: t })));
  }
  // Only the opening packets (before two advances) are withheld.
  const firstPass = out.findIndex((v) => v === 120);
  assert.ok(firstPass > 0 && firstPass <= 4, `opened at index ${firstPass}`);
  assert.ok(out.slice(firstPass).every((v) => v === 120));
});

test('devices are tracked independently', () => {
  const g = createHrBeatGate();
  g.gate('a', { heartRate: 120, beatCount: 1, beatTime: 0, now: 0 });
  g.gate('a', { heartRate: 120, beatCount: 2, beatTime: 0, now: 500 });
  assert.equal(hrOf(g.gate('a', { heartRate: 120, beatCount: 3, beatTime: 0, now: 1000 })), 120);
  assert.equal(hrOf(g.gate('b', { heartRate: 161, beatCount: 3, beatTime: 0, now: 1000 })), null);
});

test('without beat data the gate cannot judge and passes HR through', () => {
  const g = createHrBeatGate();
  assert.equal(hrOf(g.gate('x', { heartRate: 120, beatCount: undefined, beatTime: undefined, now: 0 })), 120);
});

test('BLE decoder: contact supported but not detected -> null HR', () => {
  const d = new BleHeartRateDecoder();
  // flags: bit1 = contact supported, bit2 = contact detected (clear)
  assert.equal(d.processPacket(Buffer.from([0b010, 161])), null);
  // supported + detected -> passes
  assert.equal(d.processPacket(Buffer.from([0b110, 120])).hr, 120);
  // contact not supported -> passes (strap cannot tell us)
  assert.equal(d.processPacket(Buffer.from([0b000, 120])).hr, 120);
});
