import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContinuousScanLoop } from '../src/continuousScanLoop.mjs';

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
