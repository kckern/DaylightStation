import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHaPlugCycle } from './haPlugCycle.mjs';

function gateway(script = {}) {
  const calls = [];
  let onFailures = script.onFailures ?? 0;
  return {
    calls,
    callService: async (domain, service, data) => {
      calls.push(`${domain}.${service}:${data.entity_id}`);
      if (service === 'turn_off' && script.offFails) throw new Error('HA 500');
      if (service === 'turn_on' && onFailures > 0) { onFailures -= 1; throw new Error('HA timeout'); }
    },
  };
}
const sleeps = [];
const sleep = async (ms) => { sleeps.push(ms); };

test('turns off, waits offMs, turns on', async () => {
  sleeps.length = 0;
  const ha = gateway();
  const cycle = createHaPlugCycle({ haGateway: ha, entityId: 'switch.yellow_room_piano_plug', sleep });
  assert.deepEqual(await cycle(10000), { ok: true, error: null, unpowered: false });
  assert.deepEqual(ha.calls, ['switch.turn_off:switch.yellow_room_piano_plug', 'switch.turn_on:switch.yellow_room_piano_plug']);
  assert.deepEqual(sleeps, [10000]);
});

test('turn_off failing leaves power on and reports not-unpowered', async () => {
  const ha = gateway({ offFails: true });
  const r = await createHaPlugCycle({ haGateway: ha, entityId: 'switch.p', sleep })(10000);
  assert.equal(r.ok, false);
  assert.equal(r.unpowered, false);
  assert.match(r.error, /turn_off/);
  assert.deepEqual(ha.calls, ['switch.turn_off:switch.p']);
});

test('turn_on is retried until it lands', async () => {
  const ha = gateway({ onFailures: 2 });
  const r = await createHaPlugCycle({ haGateway: ha, entityId: 'switch.p', sleep })(10000);
  assert.equal(r.ok, true);
  assert.equal(ha.calls.filter((c) => c.startsWith('switch.turn_on')).length, 3);
});

test('turn_on failing every retry reports unpowered', async () => {
  const ha = gateway({ onFailures: 99 });
  const r = await createHaPlugCycle({ haGateway: ha, entityId: 'switch.p', sleep, retries: 3 })(10000);
  assert.equal(r.ok, false);
  assert.equal(r.unpowered, true);
  assert.equal(ha.calls.filter((c) => c.startsWith('switch.turn_on')).length, 4); // first try + 3 retries
});

// The real HomeAssistantAdapter.callService never throws: it resolves {ok:false, error}.
function resolvingGateway({ offFails = false, onFailures = 0 } = {}) {
  const calls = [];
  let left = onFailures;
  return {
    calls,
    callService: async (domain, service, data) => {
      calls.push(`${domain}.${service}:${data.entity_id}`);
      if (service === 'turn_off' && offFails) return { ok: false, error: 'HA 500' };
      if (service === 'turn_on' && left > 0) { left -= 1; return { ok: false, error: 'HA timeout' }; }
      return { ok: true, data: [] };
    },
  };
}

test('a resolved {ok:false} turn_on is retried, and all-failed is unpowered', async () => {
  const ha = resolvingGateway({ onFailures: 99 });
  const r = await createHaPlugCycle({ haGateway: ha, entityId: 'switch.p', sleep, retries: 3 })(10000);
  assert.equal(r.ok, false);
  assert.equal(r.unpowered, true);
  assert.match(r.error, /turn_on: HA timeout/);
  assert.equal(ha.calls.filter((c) => c.startsWith('switch.turn_on')).length, 4);
});

test('a resolved {ok:false} turn_off never touches turn_on and is not unpowered', async () => {
  const ha = resolvingGateway({ offFails: true });
  const r = await createHaPlugCycle({ haGateway: ha, entityId: 'switch.p', sleep })(10000);
  assert.deepEqual(r, { ok: false, unpowered: false, error: 'turn_off: HA 500' });
  assert.deepEqual(ha.calls, ['switch.turn_off:switch.p']);
});
