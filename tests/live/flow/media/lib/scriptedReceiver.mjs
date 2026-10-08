// Put a fixture screen that has no mounted page into a receiver state, over the
// acceptance server's fixture route (see `scriptReceiver` in
// tests/_lib/media-ordinary-device-fixture.mjs). Use the screens no journey
// mounts: `acceptance-power` (den TV), `acceptance-speaker`, and for "off"
// either of them. `reset` (resetHouseholdAt) puts every scripted screen back to idle.
//
//   await scriptReceiver(request, { deviceId: POWER, state: 'playing', title: 'Arrival', duration: 7000,
//     origin: { kind: 'device', id: 'acceptance-media-b' } });
//
// Specs: state playing|paused|idle|off; kind video|audio|photo|slideshow|live;
// duration null = unknown (no seeking); queue = items after the current one;
// serverOffline: true = it keeps reporting (devices show it playing) but the server refuses a send with DEVICE_OFFLINE.
// A scripted screen goes silent (Off) after about a minute, as a real one would.
import { expect } from '@playwright/test';

export const SCRIPTED = Object.freeze({ POWER: 'acceptance-power', SPEAKER: 'acceptance-speaker' });

export async function scriptReceiver(request, spec) {
  const response = await request.post('/api/v1/media/_fixture/receiver', { data: spec });
  expect(response.status(), `scripting ${spec.deviceId}: ${await response.text()}`).toBe(200);
  return response.json();
}

/** Make the den TV's wake step fail (a send to it fails outright, with Retry / Another screen…). Cleared by reset. */
export async function failWake(request, deviceId = SCRIPTED.POWER, fail = true) {
  const response = await request.post('/api/v1/media/_fixture/wake', { data: { deviceId, fail } });
  expect(response.status(), `wake failure for ${deviceId}: ${await response.text()}`).toBe(200);
}
