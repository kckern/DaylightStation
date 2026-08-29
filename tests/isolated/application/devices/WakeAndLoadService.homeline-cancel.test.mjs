import { describe, expect, it, vi } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const broadcast = vi.fn();
const eventBus = { getTopicSubscriberCount: () => 0, subscribe: vi.fn() };
const runtimePorts = () => ({
  clock: { now: () => Date.now() },
  createDispatchId: () => 'generated-dispatch-id',
  scheduler: {
    wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    after: (ms, callback) => setTimeout(callback, ms),
    cancel: (handle) => clearTimeout(handle),
    withDeadline: async (operation) => operation(),
  },
});

describe('WakeAndLoadService Home Line cancellation', () => {
  it('stops after an in-flight power step when the lease is ended', async () => {
    let cancelled = false;
    const device = {
      defaultVolume: null, screenPath: '/screen/tv',
      hasCapability: capability => capability === 'deviceControl',
      powerOn: vi.fn(async () => { cancelled = true; return { ok: true, verified: true }; }),
      prepareForContent: vi.fn(async () => ({ ok: true })), loadContent: vi.fn(async () => ({ ok: true })),
    };
    const service = new WakeAndLoadService({ deviceService: { get: () => device },
      readinessPolicy: { isReady: vi.fn() }, broadcast, eventBus, logger, ...runtimePorts() });
    const result = await service.execute('tv', { open: 'videocall/tv' }, { isCancelled: () => cancelled });
    expect(result).toMatchObject({ ok: false, cancelled: true, failedStep: 'power' });
    expect(device.prepareForContent).not.toHaveBeenCalled();
    expect(device.loadContent).not.toHaveBeenCalled();
  });

  it('does not schedule the generic deferred retry for a lease-owned dispatch', async () => {
    vi.useFakeTimers();
    const device = {
      defaultVolume: null, screenPath: '/screen/tv',
      hasCapability: capability => capability === 'deviceControl',
      powerOn: vi.fn(async () => ({ ok: false, verifyFailed: true })),
      prepareForContent: vi.fn(), loadContent: vi.fn(), notifyService: null,
    };
    const service = new WakeAndLoadService({ deviceService: { get: () => device },
      readinessPolicy: { isReady: vi.fn(async () => ({ ready: false, reason: 'off' })) }, broadcast, eventBus, logger, ...runtimePorts() });
    await service.execute('tv', { open: 'videocall/tv' }, { deferredRetry: false });
    await vi.advanceTimersByTimeAsync(46_000);
    expect(device.powerOn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('adds safe call correlation to lease-owned wake progress without credentials', async () => {
    broadcast.mockClear();
    const device = {
      defaultVolume: null, screenPath: '/screen/tv',
      hasCapability: capability => capability === 'deviceControl',
      powerOn: vi.fn(async () => ({ ok: true, verified: true })),
      setVolume: vi.fn(), prepareForContent: vi.fn(async () => ({ ok: true, cameraAvailable: true })),
      loadContent: vi.fn(async () => ({ ok: true })),
    };
    const service = new WakeAndLoadService({ deviceService: { get: () => device },
      readinessPolicy: { isReady: vi.fn() }, broadcast, eventBus, logger, ...runtimePorts() });
    await service.execute('tv', { open: 'videocall/tv' }, {
      dispatchId: 'dispatch-1', deferredRetry: false,
      correlation: { callId: 'call-1', attemptId: 'attempt-1', credential: 'must-not-leak' },
    });
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      dispatchId: 'dispatch-1', callId: 'call-1', attemptId: 'attempt-1',
    }));
    expect(JSON.stringify(broadcast.mock.calls)).not.toContain('must-not-leak');
  });
});
