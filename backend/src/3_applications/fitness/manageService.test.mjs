// backend/src/3_applications/fitness/manageService.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initManageService, getManageService, _resetManageServiceForTests } from './manageService.mjs';

function fakeBus() {
  const broadcasts = [];
  let onMsg;
  return {
    broadcasts,
    broadcast: (topic, payload) => broadcasts.push({ topic, payload }),
    onClientMessage: (cb) => { onMsg = cb; },
    deliver: (msg) => onMsg?.('client-1', msg),
  };
}

test('initManageService requires a bus with broadcast + onClientMessage', () => {
  _resetManageServiceForTests();
  assert.throws(() => initManageService({ eventBus: {} }), /broadcast/);
});

test('requestEnroll broadcasts request, rebroadcasts progress with clientToken, resolves on result', async () => {
  _resetManageServiceForTests();
  const bus = fakeBus();
  const svc = initManageService({ eventBus: bus });

  const promise = svc.requestEnroll({ finger: 'right-index', username: 'test-user', clientToken: 'tok-1' });
  const req = bus.broadcasts.find((b) => b.topic === 'fitness.enroll.request');
  assert.ok(req, 'enroll request broadcast');
  const { requestId } = req.payload;

  bus.deliver({ topic: 'fitness.enroll.progress', requestId, stage: 3, stagesTotal: 5 });
  const prog = bus.broadcasts.find((b) => b.topic === 'fitness.enroll.progress');
  assert.deepEqual(prog.payload, { clientToken: 'tok-1', stage: 3, stagesTotal: 5 });

  bus.deliver({ topic: 'fitness.enroll.result', requestId, success: true, uuid: 'new-uuid' });
  assert.deepEqual(await promise, { success: true, uuid: 'new-uuid' });
});

test('requestDelete resolves on delete result', async () => {
  _resetManageServiceForTests();
  const bus = fakeBus();
  const svc = initManageService({ eventBus: bus });
  const promise = svc.requestDelete({ uuid: 'u1' });
  const req = bus.broadcasts.find((b) => b.topic === 'fitness.fingerprint.delete.request');
  bus.deliver({ topic: 'fitness.fingerprint.delete.result', requestId: req.payload.requestId, success: true });
  assert.deepEqual(await promise, { success: true });
  assert.equal(getManageService(), svc); // singleton
});
