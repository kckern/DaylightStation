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
