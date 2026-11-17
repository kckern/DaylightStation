import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataPathHealth, createFitnessDataBroadcaster } from '../src/dataPathHealth.mjs';

test('idle receiver has no invented sensor samples', () => {
  const health = createDataPathHealth({ bootId: 'boot-test', now: () => 20000 });
  const idleHealth = health.snapshot('open');
  assert.equal(idleHealth.sourceSeq, 0);
  assert.equal(idleHealth.receivedCount, 0);
  assert.equal(idleHealth.sentCount, 0);
  assert.equal(idleHealth.lastSourceAgeMs, null);
  assert.equal(idleHealth.socketPhase, 'open');
});

test('real receipts advance sequence even offline and successful socket writes alone advance sent count', () => {
  let time = 0;
  let socket = null;
  const health = createDataPathHealth({ bootId: 'boot-test', now: () => time });
  const logs = [];
  const broadcast = createFitnessDataBroadcaster({ health, getSocket: () => socket, openState: 1, logEvent: (...args) => logs.push(args) });
  broadcast({ source: 'fitness', topic: 'fitness', syntheticValue: 123 });
  assert.equal(health.snapshot().receivedCount, 1);
  assert.equal(health.snapshot().sentCount, 0);
  const frames = [];
  let complete;
  socket = { readyState: 1, send: (frame, callback) => { frames.push(JSON.parse(frame)); complete = callback; } };
  time = 100;
  broadcast({ source: 'fitness', topic: 'fitness', syntheticValue: 456 });
  assert.equal(health.snapshot().sentCount, 0);
  complete();
  assert.equal(health.snapshot().sentCount, 1);
  assert.deepEqual(frames[0], { source: 'fitness', topic: 'fitness', syntheticValue: 456, bootId: 'boot-test', sourceSeq: 2 });
  broadcast({ source: 'fitness', syntheticValue: 789 });
  complete(new Error('test send failure'));
  socket.send = () => { throw new Error('test sync failure'); };
  assert.doesNotThrow(() => broadcast({ source: 'fitness', syntheticValue: 999 }));
  assert.equal(health.snapshot().sentCount, 1);
  assert.equal(health.snapshot().receivedCount, 4);
  assert.equal(JSON.stringify(logs).includes('syntheticValue'), false);
  time = 20100;
  assert.equal(health.snapshot().lastSourceAgeMs, 20000);
});

test('a failed structured log transport cannot throw out of the sensor callback', () => {
  const health = createDataPathHealth({ bootId: 'boot-test', now: () => 0 });
  const broadcast = createFitnessDataBroadcaster({ health, openState: 1,
    getSocket: () => ({ readyState: 1, send() { throw new Error('test socket down'); } }),
    logEvent() { throw new Error('test logger uses same socket'); },
  });
  assert.doesNotThrow(() => broadcast({ source: 'fitness' }));
  assert.equal(health.snapshot().receivedCount, 1);
  assert.equal(health.snapshot().sentCount, 0);
});
