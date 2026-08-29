import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBusBiometricGateway } from '#adapters/fitness/EventBusBiometricGateway.mjs';

function harness() {
  const broadcasts = [];
  const handlers = [];
  let id = 0;
  const eventBus = {
    broadcast: (topic, payload) => broadcasts.push({ topic, payload }),
    onClientMessage: (handler) => handlers.push(handler),
  };
  const gateway = new EventBusBiometricGateway({ eventBus, idFn: () => `req-${++id}` });
  return { gateway, broadcasts, deliver: (message) => handlers.forEach((handler) => handler('garage', message)) };
}

test('biometric adapter publishes enroll, forwards progress, and correlates result', async () => {
  const { gateway, broadcasts, deliver } = harness();
  const promise = gateway.requestEnroll({ finger: 'right-index', username: 'test-user', clientToken: 'tok-1' });
  assert.deepEqual(broadcasts[0], {
    topic: 'fitness.enroll.request',
    payload: { requestId: 'req-1', finger: 'right-index', username: 'test-user' },
  });
  deliver({ topic: 'fitness.enroll.progress', requestId: 'req-1', stage: 2, stagesTotal: 5 });
  assert.deepEqual(broadcasts[1], {
    topic: 'fitness.enroll.progress', payload: { clientToken: 'tok-1', stage: 2, stagesTotal: 5 },
  });
  deliver({ topic: 'fitness.enroll.result', requestId: 'req-1', success: true, uuid: 'new-uuid' });
  assert.deepEqual(await promise, { success: true, uuid: 'new-uuid' });
});

test('biometric adapter publishes and correlates delete', async () => {
  const { gateway, broadcasts, deliver } = harness();
  const promise = gateway.requestDelete({ uuid: 'u1' });
  assert.equal(broadcasts[0].topic, 'fitness.fingerprint.delete.request');
  deliver({ topic: 'fitness.fingerprint.delete.result', requestId: 'req-1', success: true });
  assert.deepEqual(await promise, { success: true });
});
