import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScreenHold } from './screenHold.mjs';
import { ScreenOverrideService } from '#apps/devices/services/ScreenOverrideService.mjs';

function rig(status) {
  const clock = { now: () => 1_000_000 };
  const overrides = new ScreenOverrideService({ clock });
  const deviceService = { get: (id) => (id === 'yellow-room-tablet' ? { getStatus: async () => status } : null) };
  const hold = createScreenHold({ deviceService, overrides, deviceId: 'yellow-room-tablet' });
  return { overrides, hold };
}

test('pins a lit screen on for the window', async () => {
  const { overrides, hold } = rig({ screenOn: true });
  assert.equal(await hold(70_000), 'on');
  assert.deepEqual(overrides.get('yellow-room-tablet'), { state: 'on', until: 1_000_000 + 70_000 });
});

test('pins a dark screen off — never lights an empty room', async () => {
  const { overrides, hold } = rig({ screenOn: false });
  assert.equal(await hold(120_000), 'off');
  assert.equal(overrides.get('yellow-room-tablet').state, 'off');
});

test('leaves a person\'s manual override alone', async () => {
  const { overrides, hold } = rig({ screenOn: true });
  overrides.set('yellow-room-tablet', 'off', 30);
  assert.equal(await hold(70_000), null);
  assert.equal(overrides.get('yellow-room-tablet').state, 'off');
});

test('unreadable screen state holds nothing', async () => {
  const { overrides, hold } = rig(null);
  assert.equal(await hold(70_000), null);
  assert.equal(overrides.get('yellow-room-tablet'), null);
});
