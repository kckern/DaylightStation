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

test('trigger persists state, fires HA script, broadcasts locked', async () => {
  const { repo, haGateway, haCalls, eventBus, broadcasts } = makeFakes();
  const uc = new TriggerEmergencyLockdown({ repo, haGateway, eventBus, scriptId: 'garage_deactivate', defaultDurationSec: 1800 });
  const state = await uc.execute({ lockedBy: 'alice', now: 1000 });
  assert.equal(state.lockedUntil, 2800);
  assert.deepEqual(haCalls[0], { d: 'script', s: 'turn_on', data: { entity_id: 'script.garage_deactivate' } });
  assert.equal(broadcasts.at(-1).topic, 'fitness.emergency.locked');
  assert.equal((await repo.load()).lockedBy, 'alice');
});

test('HA failure aborts before persisting (no "locked but garage running")', async () => {
  const { repo, eventBus, broadcasts } = makeFakes();
  const haGateway = { async callService() { throw new Error('garage offline'); } };
  const uc = new TriggerEmergencyLockdown({ repo, haGateway, eventBus, scriptId: 'garage_deactivate', defaultDurationSec: 1800 });
  await assert.rejects(() => uc.execute({ lockedBy: 'alice', now: 1000 }), /garage offline/);
  // HA fired first and threw → nothing persisted, nothing broadcast.
  assert.equal(await repo.load(), null, 'must not persist a lock when HA fails');
  assert.equal(broadcasts.length, 0, 'must not broadcast locked when HA fails');
});

test('release clears state and broadcasts released', async () => {
  const { repo, haGateway, eventBus, broadcasts } = makeFakes();
  await new TriggerEmergencyLockdown({ repo, haGateway, eventBus, scriptId: 'garage_deactivate', defaultDurationSec: 1800 }).execute({ lockedBy: 'alice', now: 1000 });
  await new ReleaseEmergencyLockdown({ repo, eventBus }).execute({ by: 'admin', now: 1500 });
  assert.equal(await repo.load(), null);
  assert.equal(broadcasts.at(-1).topic, 'fitness.emergency.released');
});

test('GetLockdownState returns null and self-clears once expired', async () => {
  const { repo, haGateway, eventBus } = makeFakes();
  await new TriggerEmergencyLockdown({ repo, haGateway, eventBus, scriptId: 'garage_deactivate', defaultDurationSec: 100 }).execute({ lockedBy: 'alice', now: 1000 });
  const get = new GetLockdownState({ repo });
  assert.equal((await get.execute({ now: 1050 }))?.lockedBy, 'alice'); // still active
  assert.equal(await get.execute({ now: 1100 }), null);                // expired → null
  assert.equal(await repo.load(), null);                               // self-cleared
});

test('trigger uses provided durationSec over default', async () => {
  const { repo, haGateway, eventBus } = makeFakes();
  const uc = new TriggerEmergencyLockdown({ repo, haGateway, eventBus, scriptId: 'garage_deactivate', defaultDurationSec: 1800 });
  const state = await uc.execute({ lockedBy: 'alice', durationSec: 60, now: 1000 });
  assert.equal(state.lockedUntil, 1060);
});

test('trigger requires repo, haGateway, eventBus', () => {
  assert.throws(() => new TriggerEmergencyLockdown({ haGateway: {}, eventBus: {} }));
  assert.throws(() => new TriggerEmergencyLockdown({ repo: {}, eventBus: {} }));
  assert.throws(() => new TriggerEmergencyLockdown({ repo: {}, haGateway: {} }));
});
