import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContinuousScanLoop, faultBackoffMs } from '../src/continuousScanLoop.mjs';

test('broadcasts matched scans then settles', async () => {
  const sent = [];
  let calls = 0;
  const loop = createContinuousScanLoop({
    runScan: async () => {
      calls += 1;
      if (calls === 1) return { ok: true, value: { matched: true, uuid: 'uuid-1' } };
      return { ok: true, value: { matched: false, reason: 'no-match' } };
    },
    sendBus: (topic, payload) => sent.push({ topic, payload }),
    delay: async () => {},
    logger: { log() {}, error() {} },
    maxIterations: 2,
  });
  await loop.run();
  assert.deepEqual(sent[0], { topic: 'biometric.scan', payload: { modality: 'fingerprint', matched: true, uuid: 'uuid-1' } });
  assert.deepEqual(sent[1], { topic: 'biometric.scan', payload: { modality: 'fingerprint', matched: false } });
});

test('reader-busy and cancelled do not broadcast', async () => {
  const sent = [];
  const seq = [
    { ok: false, reason: 'reader-busy' },
    { ok: true, value: { matched: false, reason: 'cancelled' } },
  ];
  let i = 0;
  const loop = createContinuousScanLoop({
    runScan: async () => seq[i++],
    sendBus: (topic, payload) => sent.push({ topic, payload }),
    delay: async () => {},
    logger: { log() {}, error() {} },
    maxIterations: 2,
  });
  await loop.run();
  assert.equal(sent.length, 0);
});

test('no-templates backs off without broadcasting', async () => {
  const sent = [];
  const loop = createContinuousScanLoop({
    runScan: async () => ({ ok: true, value: { matched: false, reason: 'no-templates' } }),
    sendBus: (topic, payload) => sent.push({ topic, payload }),
    delay: async () => {},
    logger: { log() {}, error() {} },
    maxIterations: 1,
  });
  await loop.run();
  assert.equal(sent.length, 0);
});

function makeCapturingLogger() {
  const warns = [];
  const errors = [];
  const logs = [];
  return {
    warns, errors, logs,
    log: (m) => logs.push(m),
    warn: (m) => warns.push(m),
    error: (m) => errors.push(m),
  };
}

test('identify-error is surfaced with message + consecutive streak, no broadcast', async () => {
  const sent = [];
  const logger = makeCapturingLogger();
  const loop = createContinuousScanLoop({
    runScan: async () => ({ ok: true, value: { matched: false, reason: 'identify-error', error: 'uru4000 read failed' } }),
    sendBus: (topic, payload) => sent.push({ topic, payload }),
    delay: async () => {},
    logger,
    maxIterations: 3,
  });
  await loop.run();
  // The driver-health signal must never be silent, and must never broadcast a scan.
  assert.equal(sent.length, 0);
  assert.equal(logger.warns.length, 3);
  assert.match(logger.warns[0], /identify-error/);
  assert.match(logger.warns[0], /uru4000 read failed/);
  // Consecutive streak climbs so a degrading reader is obvious in the logs.
  assert.match(logger.warns[0], /#1 consecutive/);
  assert.match(logger.warns[2], /#3 consecutive/);
});

test('a successful match resets the identify-error streak', async () => {
  const logger = makeCapturingLogger();
  const seq = [
    { ok: true, value: { matched: false, reason: 'identify-error', error: 'x' } },
    { ok: true, value: { matched: true, uuid: 'uuid-1' } },
    { ok: true, value: { matched: false, reason: 'identify-error', error: 'y' } },
  ];
  let i = 0;
  const loop = createContinuousScanLoop({
    runScan: async () => seq[i++],
    sendBus: () => {},
    delay: async () => {},
    logger,
    maxIterations: 3,
  });
  await loop.run();
  // Both errors report "#1" because the match in between cleared the streak.
  assert.match(logger.warns[0], /#1 consecutive/);
  assert.match(logger.warns[1], /#1 consecutive/);
});

test('faultBackoffMs escalates from the base re-arm and caps at 30s', () => {
  // Doubling per consecutive fault: a wedged reader is probed ever more gently
  // instead of hammered at 800ms (the churn that leaked claims and wedged the box).
  assert.equal(faultBackoffMs(1), 800);
  assert.equal(faultBackoffMs(2), 1600);
  assert.equal(faultBackoffMs(3), 3200);
  assert.equal(faultBackoffMs(6), 25600);
  assert.equal(faultBackoffMs(7), 30000);   // capped
  assert.equal(faultBackoffMs(50), 30000);  // stays capped, never unbounded
});

test('identify-error streak uses escalating backoff, not a flat re-arm', async () => {
  const delays = [];
  const loop = createContinuousScanLoop({
    runScan: async () => ({ ok: true, value: { matched: false, reason: 'identify-error', error: 'busy' } }),
    sendBus: () => {},
    delay: async (ms) => { delays.push(ms); },
    logger: { log() {}, warn() {}, error() {} },
    maxIterations: 4,
  });
  await loop.run();
  assert.deepEqual(delays, [800, 1600, 3200, 6400]);
});

test('a recovery resets the backoff escalation', async () => {
  const delays = [];
  const seq = [
    { ok: true, value: { matched: false, reason: 'identify-error', error: 'x' } }, // streak 1 → 800
    { ok: true, value: { matched: false, reason: 'identify-error', error: 'x' } }, // streak 2 → 1600
    { ok: true, value: { matched: true, uuid: 'u' } },                              // recovery (settle, not a fault)
    { ok: true, value: { matched: false, reason: 'identify-error', error: 'x' } }, // streak 1 again → 800
  ];
  let i = 0;
  const loop = createContinuousScanLoop({
    runScan: async () => seq[i++],
    sendBus: () => {},
    delay: async (ms) => { delays.push(ms); },
    logger: { log() {}, warn() {}, error() {} },
    maxIterations: 4,
  });
  await loop.run();
  // 800, 1600 (fault streak), 1500 (match settle), 800 (streak reset after recovery)
  assert.deepEqual(delays, [800, 1600, 1500, 800]);
});

test('a sustained fault streak raises the wedged-reader alert exactly once', async () => {
  const logger = makeCapturingLogger();
  const loop = createContinuousScanLoop({
    runScan: async () => ({ ok: true, value: { matched: false, reason: 'identify-error', error: 'Resource busy' } }),
    sendBus: () => {},
    delay: async () => {},
    logger,
    maxIterations: 15,
  });
  await loop.run();
  const alerts = logger.errors.filter((m) => /likely wedged/.test(m));
  assert.equal(alerts.length, 1, 'alert fires once, not every iteration past threshold');
  assert.match(alerts[0], /restart the daylight-fitness container/);
});

test('reader-busy logs once on transition, not every iteration', async () => {
  const logger = makeCapturingLogger();
  const loop = createContinuousScanLoop({
    runScan: async () => ({ ok: false, reason: 'reader-busy' }),
    sendBus: () => {},
    delay: async () => {},
    logger,
    maxIterations: 5,
  });
  await loop.run();
  const busyLines = logger.logs.filter((m) => /reader-busy/.test(m));
  assert.equal(busyLines.length, 1);
});
