import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TriggerEmergencyLockdown } from './TriggerEmergencyLockdown.mjs';
import { ReleaseEmergencyLockdown } from './ReleaseEmergencyLockdown.mjs';
import { GetLockdownState } from './GetLockdownState.mjs';

function makeFakes() {
  let stored = null;
  const repo = {
    async load() { return stored; },
    async save(s) { stored = s; },
    async clear() { stored = null; },
  };
  const haCalls = [];
  const haGateway = { async callService(d, s, data) { haCalls.push({ d, s, data }); return { ok: true }; } };
  const broadcasts = [];
  const eventBus = { broadcast: (topic, payload) => broadcasts.push({ topic, payload }) };
  return { repo, haGateway, haCalls, eventBus, broadcasts };
}

test('trigger persists state, broadcasts locked, then fires HA script', async () => {
  const { repo, haGateway, haCalls, eventBus, broadcasts } = makeFakes();
  const uc = new TriggerEmergencyLockdown({ repo, haGateway, eventBus, scriptId: 'garage_deactivate', defaultDurationSec: 1800, shutdownBufferMs: 0 });
  const state = await uc.execute({ lockedBy: 'alice', now: 1000 });
  assert.equal(state.lockedUntil, 2800);
  // Screen locks first (broadcast), garage shuts down after the buffer (HA call).
  assert.equal(broadcasts[0].topic, 'fitness.emergency.locked');
  assert.deepEqual(haCalls[0], { d: 'script', s: 'turn_on', data: { entity_id: 'script.garage_deactivate' } });
  assert.equal(broadcasts.at(-1).topic, 'fitness.emergency.locked', 'no release on the happy path');
  assert.equal((await repo.load()).lockedBy, 'alice');
});

test('HA failure compensates by releasing (no "locked but garage running")', async () => {
  const { repo, eventBus, broadcasts } = makeFakes();
  const haGateway = { async callService() { throw new Error('garage offline'); } };
  const uc = new TriggerEmergencyLockdown({ repo, haGateway, eventBus, scriptId: 'garage_deactivate', defaultDurationSec: 1800, shutdownBufferMs: 0 });
  await assert.rejects(() => uc.execute({ lockedBy: 'alice', now: 1000 }), /garage offline/);
  // Lock was broadcast, but the failed HA cutover rolls it back: clear + released.
  assert.equal(await repo.load(), null, 'must not leave a lock persisted when HA fails');
  assert.equal(broadcasts[0].topic, 'fitness.emergency.locked');
  assert.equal(broadcasts.at(-1).topic, 'fitness.emergency.released', 'must release the screen when HA fails');
});

test('release clears state and broadcasts released', async () => {
  const { repo, haGateway, eventBus, broadcasts } = makeFakes();
  await new TriggerEmergencyLockdown({ repo, haGateway, eventBus, scriptId: 'garage_deactivate', defaultDurationSec: 1800, shutdownBufferMs: 0 }).execute({ lockedBy: 'alice', now: 1000 });
  await new ReleaseEmergencyLockdown({ repo, eventBus }).execute({ by: 'admin', now: 1500 });
  assert.equal(await repo.load(), null);
  assert.equal(broadcasts.at(-1).topic, 'fitness.emergency.released');
});

test('GetLockdownState returns null and self-clears once expired', async () => {
  const { repo, haGateway, eventBus } = makeFakes();
  await new TriggerEmergencyLockdown({ repo, haGateway, eventBus, scriptId: 'garage_deactivate', defaultDurationSec: 100, shutdownBufferMs: 0 }).execute({ lockedBy: 'alice', now: 1000 });
  const get = new GetLockdownState({ repo });
  assert.equal((await get.execute({ now: 1050 }))?.lockedBy, 'alice'); // still active
  assert.equal(await get.execute({ now: 1100 }), null);                // expired → null
  assert.equal(await repo.load(), null);                               // self-cleared
});

test('trigger uses provided durationSec over default', async () => {
  const { repo, haGateway, eventBus } = makeFakes();
  const uc = new TriggerEmergencyLockdown({ repo, haGateway, eventBus, scriptId: 'garage_deactivate', defaultDurationSec: 1800, shutdownBufferMs: 0 });
  const state = await uc.execute({ lockedBy: 'alice', durationSec: 60, now: 1000 });
  assert.equal(state.lockedUntil, 1060);
});

test('trigger requires repo, haGateway, eventBus', () => {
  assert.throws(() => new TriggerEmergencyLockdown({ haGateway: {}, eventBus: {} }));
  assert.throws(() => new TriggerEmergencyLockdown({ repo: {}, eventBus: {} }));
  assert.throws(() => new TriggerEmergencyLockdown({ repo: {}, haGateway: {} }));
});
