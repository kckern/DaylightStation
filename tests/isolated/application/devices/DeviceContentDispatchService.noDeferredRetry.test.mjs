// RQ-STEER-07 / RELY.6a: a Media press that cannot be delivered is terminal.
// Media asks for no deferred backend retry, so a failed cast can never start
// playing 45 seconds later on its own. Routines that omit the flag keep the
// existing one-shot retry behaviour.
import { describe, it, expect, vi } from 'vitest';
import { DeviceContentDispatchService } from '../../../../backend/src/3_applications/devices/services/DeviceContentDispatchService.mjs';

function setup() {
  const calls = [];
  const wake = { execute: vi.fn(async (deviceId, query, options) => { calls.push({ deviceId, query, options }); return { ok: false, failedStep: 'verify' }; }) };
  const service = new DeviceContentDispatchService({ wakeAndLoad: wake, logger: {}, configuration: {} });
  return { service, calls };
}

describe('DeviceContentDispatchService deferred retry opt-out', () => {
  it('turns deferredRetry=0 into an execute option and keeps it out of the receiver query', async () => {
    const { service, calls } = setup();
    await service.load('tv', { play: 'plex:1', dispatchId: 'd-1', deferredRetry: '0' });
    expect(calls[0].options).toMatchObject({ dispatchId: 'd-1', deferredRetry: false });
    expect(calls[0].query).toEqual({ play: 'plex:1' });
  });

  it('leaves routine loads without the flag on the default retry path', async () => {
    const { service, calls } = setup();
    await service.load('tv', { queue: 'morning-program' });
    expect(calls[0].options.deferredRetry).toBeUndefined();
    expect(calls[0].query).toEqual({ queue: 'morning-program' });
  });
});
