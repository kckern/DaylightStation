import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmergencyDetector } from './emergencyDetector.mjs';
import { EMERGENCY_LOCK } from './emergencyPolicy.mjs';

// --- shared fixtures ---------------------------------------------------------

const profiles = {
  alice: {
    identities: {
      admin: true,
      fingerprints: [{ id: 'uuid-a1', finger: 'right-index' }],
    },
  },
};
const userService = { getProfile: (u) => profiles[u] || null };

function makeFitnessConfig() {
  return { locks: { [EMERGENCY_LOCK]: ['alice'] } };
}

// A controllable clock starting at an arbitrary epoch.
function makeClock(start = 1000) {
  let now = start;
  const clock = () => now;
  clock.advance = (ms) => { now += ms; };
  clock.set = (v) => { now = v; };
  return clock;
}

// Poll a predicate up to `tries` times, yielding the event loop between checks
// so the detector loop (driven by real setTimeout with tiny delays) can run.
async function waitFor(predicate, { tries = 200, intervalMs = 5 } = {}) {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// -----------------------------------------------------------------------------

test('detects a match: broadcasts fitness.emergency.detected and records pending', async (t) => {
  const broadcasts = [];
  const clock = makeClock();
  let calls = 0;

  const unlockService = {
    isForegroundActive: () => false,
    requestUnlock: async () => {
      calls += 1;
      if (calls === 1) return { matched: true, userId: 'alice' };
      // Subsequent arms "time out" after a small real delay so the loop does
      // not busy-spin (mirrors a real scan that blocks for armTimeoutMs).
      await new Promise((r) => setTimeout(r, 10));
      return { matched: false, reason: 'timeout' };
    },
  };
  const eventBus = { broadcast: (topic, payload) => broadcasts.push({ topic, payload }) };

  const detector = createEmergencyDetector({
    unlockService,
    eventBus,
    loadFitnessConfig: () => makeFitnessConfig(),
    userService,
    isLocked: async () => false,
    clock,
    armTimeoutMs: 5,
    idleDelayMs: 1,
    settleDelayMs: 2,
  });
  t.after(() => detector.stop());

  detector.start();

  const got = await waitFor(() =>
    broadcasts.some((b) => b.topic === 'fitness.emergency.detected'));
  assert.equal(got, true, 'expected a fitness.emergency.detected broadcast');

  const evt = broadcasts.find((b) => b.topic === 'fitness.emergency.detected');
  assert.equal(evt.payload.userId, 'alice');
  assert.equal(typeof evt.payload.at, 'number');

  const pending = detector.consumePendingDetection();
  assert.ok(pending, 'expected a pending detection');
  assert.equal(pending.userId, 'alice');

  // Second immediate consume should be null (consumed once).
  assert.equal(detector.consumePendingDetection(), null);

  await detector.stop();
});

test('yields to foreground: requestUnlock is never called', async (t) => {
  let calls = 0;
  const unlockService = {
    isForegroundActive: () => true,
    requestUnlock: async () => { calls += 1; return { matched: false }; },
  };
  const detector = createEmergencyDetector({
    unlockService,
    eventBus: { broadcast: () => {} },
    loadFitnessConfig: () => makeFitnessConfig(),
    userService,
    isLocked: async () => false,
    idleDelayMs: 1,
    settleDelayMs: 1,
    armTimeoutMs: 5,
  });
  t.after(() => detector.stop());

  detector.start();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls, 0, 'requestUnlock must not be called while foreground active');
  await detector.stop();
});

test('skips while locked: requestUnlock is never called', async (t) => {
  let calls = 0;
  const unlockService = {
    isForegroundActive: () => false,
    requestUnlock: async () => { calls += 1; return { matched: false }; },
  };
  const detector = createEmergencyDetector({
    unlockService,
    eventBus: { broadcast: () => {} },
    loadFitnessConfig: () => makeFitnessConfig(),
    userService,
    isLocked: async () => true,
    idleDelayMs: 1,
    settleDelayMs: 1,
    armTimeoutMs: 5,
  });
  t.after(() => detector.stop());

  detector.start();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls, 0, 'requestUnlock must not be called while locked');
  await detector.stop();
});

test('no candidates: does not arm', async (t) => {
  let calls = 0;
  const unlockService = {
    isForegroundActive: () => false,
    requestUnlock: async () => { calls += 1; return { matched: false }; },
  };
  const detector = createEmergencyDetector({
    unlockService,
    eventBus: { broadcast: () => {} },
    loadFitnessConfig: () => ({ locks: {} }), // no emergency lock => []
    userService,
    isLocked: async () => false,
    idleDelayMs: 1,
    settleDelayMs: 1,
    armTimeoutMs: 5,
  });
  t.after(() => detector.stop());

  detector.start();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls, 0, 'requestUnlock must not be called when there are no candidates');
  await detector.stop();
});

test('activeHours gating: does not arm outside the configured window', async (t) => {
  let calls = 0;
  const unlockService = {
    isForegroundActive: () => false,
    requestUnlock: async () => { calls += 1; return { matched: false }; },
  };
  const detector = createEmergencyDetector({
    unlockService,
    eventBus: { broadcast: () => {} },
    loadFitnessConfig: () => makeFitnessConfig(),
    userService,
    isLocked: async () => false,
    idleDelayMs: 1,
    settleDelayMs: 1,
    armTimeoutMs: 5,
    activeHours: { start: 6, end: 22 },
    getHour: () => 3, // 3am → outside 6–22 window
  });
  t.after(() => detector.stop());

  detector.start();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls, 0, 'must not arm outside active hours');
  await detector.stop();
});

test('activeHours gating: arms inside the window (incl. overnight wrap)', async (t) => {
  let calls = 0;
  const unlockService = {
    isForegroundActive: () => false,
    requestUnlock: async () => { calls += 1; await new Promise((r) => setTimeout(r, 5)); return { matched: false }; },
  };
  // Overnight window 22:00–06:00; current hour 23 is inside.
  const detector = createEmergencyDetector({
    unlockService,
    eventBus: { broadcast: () => {} },
    loadFitnessConfig: () => makeFitnessConfig(),
    userService,
    isLocked: async () => false,
    idleDelayMs: 1,
    settleDelayMs: 1,
    armTimeoutMs: 5,
    activeHours: { start: 22, end: 6 },
    getHour: () => 23,
  });
  t.after(() => detector.stop());

  detector.start();
  const armed = await waitFor(() => calls > 0);
  assert.equal(armed, true, 'must arm inside the overnight window');
  await detector.stop();
});

test('interArmIdleMs inserts a gap between non-matched arms', async (t) => {
  const armTimes = [];
  const unlockService = {
    isForegroundActive: () => false,
    requestUnlock: async () => { armTimes.push(Date.now()); await new Promise((r) => setTimeout(r, 2)); return { matched: false }; },
  };
  const detector = createEmergencyDetector({
    unlockService,
    eventBus: { broadcast: () => {} },
    loadFitnessConfig: () => makeFitnessConfig(),
    userService,
    isLocked: async () => false,
    idleDelayMs: 1,
    settleDelayMs: 1,
    armTimeoutMs: 5,
    interArmIdleMs: 40,
  });
  t.after(() => detector.stop());

  detector.start();
  await waitFor(() => armTimes.length >= 2);
  await detector.stop();
  // With a 40ms inter-arm gap, consecutive arms are spaced clearly more than the
  // ~2ms scan time — proves the gap is applied between re-arms.
  assert.ok(armTimes.length >= 2, 'expected at least two arms');
  assert.ok(armTimes[1] - armTimes[0] >= 30, `expected >=~40ms gap, got ${armTimes[1] - armTimes[0]}ms`);
});

test('pending honors TTL: expired detection returns null', async (t) => {
  const broadcasts = [];
  const clock = makeClock();
  let calls = 0;
  const unlockService = {
    isForegroundActive: () => false,
    requestUnlock: async () => {
      calls += 1;
      if (calls === 1) return { matched: true, userId: 'alice' };
      await new Promise((r) => setTimeout(r, 10));
      return { matched: false, reason: 'timeout' };
    },
  };
  const detector = createEmergencyDetector({
    unlockService,
    eventBus: { broadcast: (topic, payload) => broadcasts.push({ topic, payload }) },
    loadFitnessConfig: () => makeFitnessConfig(),
    userService,
    isLocked: async () => false,
    clock,
    armTimeoutMs: 5,
    idleDelayMs: 1,
    settleDelayMs: 2,
    pendingTtlMs: 30000,
  });
  t.after(() => detector.stop());

  detector.start();
  const got = await waitFor(() =>
    broadcasts.some((b) => b.topic === 'fitness.emergency.detected'));
  assert.equal(got, true);

  // Stop the loop so it can't re-capture & refresh pending while we advance time.
  await detector.stop();

  // Advance the injected clock past the TTL.
  clock.advance(30001);
  assert.equal(detector.consumePendingDetection(), null, 'expired pending must be null');
});
