import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WakeAndLoadService } from '#apps/devices/services/WakeAndLoadService.mjs';

describe('WakeAndLoadService', () => {
  let mockLogger;
  let mockBroadcast;

  function createMockDevice(overrides = {}) {
    return {
      id: 'living-room',
      screenPath: '/screen/living-room',
      defaultVolume: null,
      hasCapability: () => false,
      powerOn: vi.fn(async () => ({ ok: true, verified: true })),
      prepareForContent: vi.fn(async () => ({ ok: true })),
      loadContent: overrides.loadContent || vi.fn(async () => ({ ok: true, url: 'http://test/screen/living-room' })),
      ...overrides,
    };
  }

  function createMockDeviceService(device) {
    return { get: vi.fn(() => device) };
  }

  function createMockReadinessPolicy() {
    return { isReady: vi.fn(async () => ({ ready: true })) };
  }

  beforeEach(() => {
    mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    mockBroadcast = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should complete successfully when all steps pass', async () => {
    const device = createMockDevice();
    const service = new WakeAndLoadService({
      deviceService: createMockDeviceService(device),
      readinessPolicy: createMockReadinessPolicy(),
      broadcast: mockBroadcast,
      logger: mockLogger,
    });

    const result = await service.execute('living-room', { queue: 'morning-program' });

    expect(result.ok).toBe(true);
    expect(result.failedStep).toBeUndefined();
    expect(device.loadContent).toHaveBeenCalledWith('/screen/living-room', { queue: 'morning-program' });
  });

  it('should use WebSocket fallback when URL load fails with content query', async () => {
    let loadCallCount = 0;
    const device = createMockDevice({
      loadContent: vi.fn(async (_path, query) => {
        loadCallCount++;
        if (loadCallCount === 1) return { ok: false, error: 'socket hang up' };
        return { ok: true, url: 'http://test/screen/living-room' };
      }),
    });

    const service = new WakeAndLoadService({
      deviceService: createMockDeviceService(device),
      readinessPolicy: createMockReadinessPolicy(),
      broadcast: mockBroadcast,
      logger: mockLogger,
    });

    const execPromise = service.execute('living-room', { queue: 'morning-program' });
    // Advance past the 3s wait + 2s mount wait in WS fallback
    await vi.advanceTimersByTimeAsync(6000);
    const result = await execPromise;

    expect(result.ok).toBe(true);
    expect(result.steps.load.method).toBe('websocket-fallback');
    expect(result.steps.load.urlError).toBe('socket hang up');
    expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({ queue: 'morning-program' }));
  });

  it('should fail when URL load fails with no content query', async () => {
    const device = createMockDevice({
      loadContent: vi.fn(async () => ({ ok: false, error: 'socket hang up' })),
    });

    const service = new WakeAndLoadService({
      deviceService: createMockDeviceService(device),
      readinessPolicy: createMockReadinessPolicy(),
      broadcast: mockBroadcast,
      logger: mockLogger,
    });

    const result = await service.execute('living-room', {});

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe('load');
    expect(result.error).toBe('socket hang up');
  });

  it('should return device not found for unknown device', async () => {
    const service = new WakeAndLoadService({
      deviceService: { get: () => null },
      readinessPolicy: createMockReadinessPolicy(),
      broadcast: mockBroadcast,
      logger: mockLogger,
    });

    const result = await service.execute('nonexistent', {});

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Device not found');
  });
});
