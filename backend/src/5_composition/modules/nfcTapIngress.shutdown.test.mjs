import assert from 'node:assert/strict';
import test from 'node:test';
import { createNfcTapIngress } from './nfcTapIngress.mjs';

test('the configured shutdown card activates shutdown before school or generic NFC dispatch', async () => {
  const calls = [];
  const ingress = createNfcTapIngress({
    eventBus: { subscribe() { return () => {}; } },
    triggerConfig: { nfc: { tags: { '04aa660fcb2a81': { global: { school_learner: 'a-child' } } } } },
    resolvePersonalCard: { async execute() { calls.push('school'); } },
    triggerDispatchService: { async handleEvent() { calls.push('trigger'); return { ok: true }; } },
    shutdownService: { async activate(payload) { calls.push(payload); return { lockedUntil: '2030-01-01T00:00:00.000Z' }; } },
    getShutdownConfig: () => ({ nfc: { reader_id: 'study-omr', tag_uid: '04aa660fcb2a81' } }),
    location: 'study',
  });
  const result = await ingress.handleTap({ id: 'study-omr', uid: '04-AA-66-0F-CB-2A-81' });
  assert.deepEqual(result, { status: 'shutdown_locked', lockedUntil: '2030-01-01T00:00:00.000Z' });
  assert.deepEqual(calls, [{ readerId: 'study-omr', tagUid: '04aa660fcb2a81' }]);
});

test('the configured shutdown card cannot activate from a different reader', async () => {
  let activations = 0;
  const ingress = createNfcTapIngress({
    eventBus: { subscribe() { return () => {}; } },
    shutdownService: { async activate() { activations += 1; } },
    getShutdownConfig: () => ({ nfc: { reader_id: 'study-omr', tag_uid: '04aa660fcb2a81' } }),
  });
  const result = await ingress.handleTap({ id: 'other-reader', uid: '04aa660fcb2a81' });
  assert.equal(result.status, 'unrouted');
  assert.equal(activations, 0);
});
