import { describe, it, expect, vi } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';

function setup({ sendPush, deviceOverrides = {} }) {
  const retries = [];
  const device = {
    id: 'livingroom-tv', name: 'Living Room TV', notifyService: 'mobile_app_owner_phone', screenPath: '/screen/x', defaultVolume: null,
    hasCapability: (cap) => cap === 'deviceControl',
    prepareForContent: async () => ({ ok: true }),
    loadContent: async () => ({ ok: true }),
    powerOn: async () => ({ ok: true, verified: false }),
    ...deviceOverrides,
  };
  const service = new WakeAndLoadService({
    contentRequiresCamera: () => false,
    clock: { now: () => 0 }, createDispatchId: () => 'd1',
    scheduler: { wait: async () => {}, after: (_ms, fn) => { retries.push(fn); return () => {}; }, withDeadline: w => Promise.resolve(w) },
    deviceService: { get: () => device },
    readinessPolicy: { isReady: async () => ({ ready: false, reason: 'display-off' }) },
    screenGateway: { screenSubscriberCount: () => 0, publishProgress() {} },
    sendPush,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  return { service, retries };
}

describe('WakeAndLoadService power-failure push', () => {
  it('after the retry fails, pushes once through the injected sender with the device HA target', async () => {
    const sendPush = vi.fn().mockResolvedValue([{ delivered: true }]);
    const { service, retries } = setup({ sendPush });
    await service.execute('livingroom-tv', { queue: 'q' });
    expect(retries).toHaveLength(1);
    await retries[0]();
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush.mock.calls[0][0]).toMatchObject({
      title: "📺 Living Room TV didn't turn on", message: "It didn't respond after a retry",
      data: expect.objectContaining({ tag: 'tv-livingroom-tv' }), haNotifyService: 'mobile_app_owner_phone',
    });
  });
  it('does not push when the device names no notify target', async () => {
    const sendPush = vi.fn();
    const { service, retries } = setup({ sendPush, deviceOverrides: { notifyService: null } });
    await service.execute('livingroom-tv', { queue: 'q' });
    await retries[0]?.();
    expect(sendPush).not.toHaveBeenCalled();
  });
});
