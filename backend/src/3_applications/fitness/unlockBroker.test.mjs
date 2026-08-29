import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBusBiometricGateway } from '#adapters/fitness/EventBusBiometricGateway.mjs';

function harness() {
  const broadcasts = [];
  const handlers = [];
  const timers = new Map();
  let timerId = 0;
  const eventBus = {
    broadcast: (topic, payload) => broadcasts.push({ topic, payload }),
    onClientMessage: (handler) => handlers.push(handler),
  };
  const gateway = new EventBusBiometricGateway({
    eventBus,
    idFn: () => 'req-1',
    setTimer: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    unlockTimeoutMs: 1000,
  });
  return {
    gateway, broadcasts, timers,
    deliver: (message) => handlers.forEach((handler) => handler('garage', message)),
  };
}

test('biometric adapter publishes and correlates an unlock result', async () => {
  const { gateway, broadcasts, deliver } = harness();
  const promise = gateway.requestUnlock('lock-x', ['uuid-a']);
  assert.deepEqual(broadcasts[0], {
    topic: 'fitness.unlock.request',
    payload: { requestId: 'req-1', lockName: 'lock-x', candidateUuids: ['uuid-a'] },
  });
  deliver({ topic: 'fitness.unlock.result', requestId: 'other', matched: true });
  deliver({ topic: 'fitness.unlock.result', requestId: 'req-1', matched: true, userId: 'test-user' });
  assert.deepEqual(await promise, { matched: true, userId: 'test-user' });
});

test('biometric adapter owns unlock timeout settlement', async () => {
  const { gateway, timers } = harness();
  const promise = gateway.requestUnlock('lock-x', []);
  assert.equal(timers.size, 1);
  [...timers.values()][0].callback();
  assert.deepEqual(await promise, { matched: false, reason: 'timeout' });
});
