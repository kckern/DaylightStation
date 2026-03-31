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

  describe('WS-first content delivery', () => {
    function createMockEventBus({ subscriberCount = 1, ackMessage = null, ackDelay = 50 } = {}) {
      return {
        getTopicSubscriberCount: vi.fn(() => subscriberCount),
        waitForMessage: vi.fn((_predicate, _timeout) => {
          if (ackMessage) {
            return new Promise(resolve => setTimeout(() => resolve(ackMessage), ackDelay));
          }
          return new Promise((_, reject) =>
            setTimeout(() => reject(new Error('waitForMessage timed out after 4000ms')), 50)
          );
        }),
      };
    }

    it('should use WS delivery when warm prepare and subscribers exist', async () => {
      const device = createMockDevice({
        prepareForContent: vi.fn(async () => ({ ok: true, coldRestart: false })),
        loadContent: vi.fn(async () => { throw new Error('should not be called'); }),
      });

      const mockEventBus = createMockEventBus({
        subscriberCount: 2,
        ackMessage: { type: 'content-ack', screen: 'living-room', timestamp: Date.now() },
      });

      const service = new WakeAndLoadService({
        deviceService: createMockDeviceService(device),
        readinessPolicy: createMockReadinessPolicy(),
        broadcast: mockBroadcast,
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      const execPromise = service.execute('living-room', { queue: 'morning-program' });
      await vi.advanceTimersByTimeAsync(200);
      const result = await execPromise;

      expect(result.ok).toBe(true);
      expect(result.steps.load.method).toBe('websocket');
      expect(result.steps.load.ok).toBe(true);
      expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({ queue: 'morning-program' }));
      expect(device.loadContent).not.toHaveBeenCalled();
    });

    it('should fall back to FKB when WS ack times out', async () => {
      const device = createMockDevice({
        prepareForContent: vi.fn(async () => ({ ok: true, coldRestart: false })),
        loadContent: vi.fn(async () => ({ ok: true, url: 'http://test/tv' })),
      });

      const mockEventBus = createMockEventBus({
        subscriberCount: 1,
        ackMessage: null,
      });

      const service = new WakeAndLoadService({
        deviceService: createMockDeviceService(device),
        readinessPolicy: createMockReadinessPolicy(),
        broadcast: mockBroadcast,
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      const execPromise = service.execute('living-room', { queue: 'morning-program' });
      await vi.advanceTimersByTimeAsync(200);
      const result = await execPromise;

      expect(result.ok).toBe(true);
      expect(result.steps.load.method).toBe('fkb-fallback');
      expect(result.steps.load.wsError).toBe('ack-timeout');
      expect(device.loadContent).toHaveBeenCalled();
    });

    it('should skip WS and go straight to FKB on cold restart', async () => {
      const device = createMockDevice({
        prepareForContent: vi.fn(async () => ({ ok: true, coldRestart: true })),
      });

      const mockEventBus = createMockEventBus({ subscriberCount: 3 });

      const service = new WakeAndLoadService({
        deviceService: createMockDeviceService(device),
        readinessPolicy: createMockReadinessPolicy(),
        broadcast: mockBroadcast,
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      const result = await service.execute('living-room', { queue: 'morning-program' });

      expect(result.ok).toBe(true);
      expect(result.steps.load.method).toBeUndefined();
      expect(mockEventBus.getTopicSubscriberCount).not.toHaveBeenCalled();
      expect(device.loadContent).toHaveBeenCalled();
    });

    it('should skip WS and go straight to FKB when no subscribers', async () => {
      const device = createMockDevice({
        prepareForContent: vi.fn(async () => ({ ok: true, coldRestart: false })),
      });

      const mockEventBus = createMockEventBus({ subscriberCount: 0 });

      const service = new WakeAndLoadService({
        deviceService: createMockDeviceService(device),
        readinessPolicy: createMockReadinessPolicy(),
        broadcast: mockBroadcast,
        eventBus: mockEventBus,
        logger: mockLogger,
      });

      const result = await service.execute('living-room', { queue: 'morning-program' });

      expect(result.ok).toBe(true);
      expect(result.steps.load.wsSkipped).toBe('no-subscribers');
      expect(device.loadContent).toHaveBeenCalled();
    });

    it('should skip WS when no eventBus is configured', async () => {
      const device = createMockDevice({
        prepareForContent: vi.fn(async () => ({ ok: true, coldRestart: false })),
      });

      const service = new WakeAndLoadService({
        deviceService: createMockDeviceService(device),
        readinessPolicy: createMockReadinessPolicy(),
        broadcast: mockBroadcast,
        logger: mockLogger,
      });

      const result = await service.execute('living-room', { queue: 'morning-program' });

      expect(result.ok).toBe(true);
      expect(device.loadContent).toHaveBeenCalled();
    });
  });
});
