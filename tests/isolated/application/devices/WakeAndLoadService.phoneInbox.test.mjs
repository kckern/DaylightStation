// The phone (content_control phone-inbox): a play no one collected within the ack
// wait is taken back and reported not delivered (never a late play, no retry), and a
// final refusal from the adapter (two phones live, none picked) goes straight back.
// ops:docs/superpowers/plans/2026-11-26-phone-downloads-hardening.md §H.
import { contentRequiresCamera } from '../../../../__backend/src/5_composition/policies/contentRequiresCamera.mjs';
import { describe, it, expect, vi } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';
import { testApplicationRuntime } from '../../../_lib/applicationRuntime.mjs';

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function phone(overrides = {}) {
  return {
    id: 'phone',
    screenPath: '/screen/phone',
    defaultVolume: null,
    notifyService: null,
    hasCapability: vi.fn((cap) => cap === 'contentControl'),
    powerOn: vi.fn().mockResolvedValue({ ok: false, error: 'No device control configured' }),
    setVolume: vi.fn().mockResolvedValue({ ok: true }),
    prepareForContent: vi.fn().mockResolvedValue({ ok: true, coldRestart: false, cameraAvailable: true }),
    loadContent: vi.fn().mockResolvedValue({ ok: true, method: 'phone-inbox' }),
    cancelPendingContent: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

function service(device, ack) {
  return new WakeAndLoadService({
    contentRequiresCamera,
    ...testApplicationRuntime(),
    deviceService: { get: vi.fn().mockReturnValue(device) },
    readinessPolicy: { isReady: vi.fn() },
    broadcast: () => {},
    screenGateway: { publishProgress: vi.fn(), screenSubscriberCount: () => 0 },
    eventBus: {
      getTopicSubscriberCount: () => 0,
      waitForMessage: vi.fn(() => (ack ? Promise.resolve(ack) : Promise.reject(new Error('timeout waiting for message')))),
    },
    logger: logger(),
  });
}

describe('WakeAndLoadService and the phone inbox', () => {
  it('a play the phone did not collect in time is taken back and is not delivered', async () => {
    const device = phone();
    const result = await service(device, null).execute('phone', { play: 'plex:1' }, { dispatchId: 'd1', deferredRetry: false });
    expect(device.cancelPendingContent).toHaveBeenCalledWith('d1');
    expect(result).toMatchObject({ ok: false, failedStep: 'load', notDelivered: true, error: 'Not picked up' });
  });

  it('collected but not yet confirmed: not cancelled, the dispatch stands', async () => {
    const device = phone({ cancelPendingContent: vi.fn().mockReturnValue(false) });
    const result = await service(device, null).execute('phone', { play: 'plex:1' }, { dispatchId: 'd2', deferredRetry: false });
    expect(result.failedStep).toBeUndefined();
  });

  it('acked: delivered', async () => {
    const device = phone();
    const result = await service(device, { ok: true }).execute('phone', { play: 'plex:1' }, { dispatchId: 'd3', deferredRetry: false });
    expect(device.cancelPendingContent).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('a final refusal (choose a phone) is reported as is, with no fallback', async () => {
    const device = phone({ loadContent: vi.fn().mockResolvedValue({ ok: false, final: true, code: 'CHOOSE_PHONE', error: 'Two phones are connected: choose one', installs: [{ installId: 'install-aaaa-1111', model: 'SM-S921U' }] }) });
    const result = await service(device, null).execute('phone', { play: 'plex:1' }, { dispatchId: 'd4', deferredRetry: false });
    expect(device.loadContent).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, failedStep: 'load', code: 'CHOOSE_PHONE', installs: [{ model: 'SM-S921U' }] });
  });
});
