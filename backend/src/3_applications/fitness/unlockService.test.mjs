// backend/src/3_applications/fitness/unlockService.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initUnlockService,
  getUnlockService,
  _resetUnlockServiceForTests,
  UNLOCK_REQUEST_TOPIC,
  UNLOCK_RESULT_TOPIC,
} from './unlockService.mjs';

/**
 * Minimal fake of the WebSocketEventBus surface the service uses:
 *  - broadcast(topic, payload): records the outbound publish
 *  - onClientMessage(handler): stores inbound handlers; `emit` replays a
 *    client message through them (mirrors how the real bus dispatches).
 */
function makeFakeBus() {
  const broadcasts = [];
  const messageHandlers = [];
  return {
    broadcasts,
    broadcast(topic, payload) {
      broadcasts.push({ topic, payload });
    },
    onClientMessage(handler) {
      messageHandlers.push(handler);
    },
    // Test helper: simulate an inbound client message.
    emit(clientId, message) {
      for (const h of messageHandlers) h(clientId, message);
    },
  };
}

test('initUnlockService broadcasts the request topic on requestUnlock', async (t) => {
  t.after(_resetUnlockServiceForTests);
  const bus = makeFakeBus();
  const svc = initUnlockService({ eventBus: bus, timeoutMs: 1000 });

  const candidates = [{ uuid: 'uuid-1', username: 'test-user' }];
  svc.requestUnlock('dance_party', candidates);

  assert.equal(bus.broadcasts.length, 1);
  const { topic, payload } = bus.broadcasts[0];
  assert.equal(topic, UNLOCK_REQUEST_TOPIC);
  assert.equal(payload.lockName, 'dance_party');
  assert.deepEqual(payload.candidateUuids, candidates);
  assert.equal(typeof payload.requestId, 'string');
  assert.ok(payload.requestId.length > 0);
});

test('an inbound fitness.unlock.result resolves the matching pending request', async (t) => {
  t.after(_resetUnlockServiceForTests);
  const bus = makeFakeBus();
  const svc = initUnlockService({ eventBus: bus, timeoutMs: 1000 });

  const promise = svc.requestUnlock('dance_party', [{ uuid: 'uuid-1', username: 'test-user' }]);
  const { requestId } = bus.broadcasts[0].payload;

  // Garage replies with a match for that requestId.
  bus.emit('garage-client', {
    topic: UNLOCK_RESULT_TOPIC,
    requestId,
    matched: true,
    userId: 'test-user',
  });

  const result = await promise;
  assert.deepEqual(result, { matched: true, userId: 'test-user' });
});

test('a stub (not-implemented) result resolves as not matched', async (t) => {
  t.after(_resetUnlockServiceForTests);
  const bus = makeFakeBus();
  const svc = initUnlockService({ eventBus: bus, timeoutMs: 1000 });

  const promise = svc.requestUnlock('dance_party', []);
  const { requestId } = bus.broadcasts[0].payload;

  bus.emit('garage-client', {
    topic: UNLOCK_RESULT_TOPIC,
    requestId,
    matched: false,
    reason: 'not-implemented',
  });

  const result = await promise;
  assert.equal(result.matched, false);
  assert.equal(result.userId, undefined);
});

test('inbound results for unknown topics or requestIds are ignored', async (t) => {
  t.after(_resetUnlockServiceForTests);
  const bus = makeFakeBus();
  const svc = initUnlockService({ eventBus: bus, timeoutMs: 50 });

  const promise = svc.requestUnlock('dance_party', []);
  const { requestId } = bus.broadcasts[0].payload;

  // Wrong topic — should not settle.
  bus.emit('garage-client', { topic: 'fitness', requestId, matched: true });
  // Unknown requestId — should not settle this promise.
  bus.emit('garage-client', { topic: UNLOCK_RESULT_TOPIC, requestId: 'other', matched: true });

  // The real correlator times out → matched:false reason:timeout.
  const result = await promise;
  assert.deepEqual(result, { matched: false, reason: 'timeout' });
});

test('initUnlockService is a singleton and getUnlockService returns it', async (t) => {
  t.after(_resetUnlockServiceForTests);
  const bus = makeFakeBus();
  const first = initUnlockService({ eventBus: bus, timeoutMs: 1000 });
  const second = initUnlockService({ eventBus: makeFakeBus(), timeoutMs: 999 });
  assert.equal(first, second, 'repeat init returns the same instance');
  assert.equal(getUnlockService(), first);
});

test('initUnlockService throws without a usable eventBus', async (t) => {
  t.after(_resetUnlockServiceForTests);
  assert.throws(() => initUnlockService({ eventBus: null }), /eventBus/);
});

test('initUnlockService throws when eventBus lacks onClientMessage', async (t) => {
  // Both broadcast() and onClientMessage() are mandatory: validating only the
  // former would let init succeed while every reply silently vanished.
  t.after(_resetUnlockServiceForTests);
  const broadcastOnlyBus = { broadcast() {} };
  assert.throws(() => initUnlockService({ eventBus: broadcastOnlyBus }), /onClientMessage/);
});
