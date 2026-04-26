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
    // Phase 4: FKB-fallback load passes verifyAsync:true so the response
    // doesn't block on the ~10s currentUrl poll (which routinely never
    // matches on Shield TV). Playback watchdog is the real signal.
    expect(device.loadContent).toHaveBeenCalledWith(
      '/screen/living-room',
      { queue: 'morning-program' },
      { verifyAsync: true },
    );
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
    expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'homeline:living-room',
      type: 'command',
      command: 'queue',
      params: expect.objectContaining({ op: 'play-now', contentId: 'morning-program' }),
    }));
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
      expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({
        topic: 'homeline:living-room',
        type: 'command',
        command: 'queue',
        params: expect.objectContaining({ op: 'play-now', contentId: 'morning-program' }),
      }));
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

  describe('dispatchId propagation (§9.9)', () => {
    it('uses the provided dispatchId on every wake-progress event and on the result', async () => {
      const device = createMockDevice();
      const service = new WakeAndLoadService({
        deviceService: createMockDeviceService(device),
        readinessPolicy: createMockReadinessPolicy(),
        broadcast: mockBroadcast,
        logger: mockLogger,
      });

      const customId = 'disp-abc-123';
      const result = await service.execute(
        'living-room',
        { queue: 'morning-program' },
        { dispatchId: customId },
      );

      expect(result.ok).toBe(true);
      expect(result.dispatchId).toBe(customId);

      const progressCalls = mockBroadcast.mock.calls
        .map((args) => args[0])
        .filter((p) => p && p.type === 'wake-progress');

      expect(progressCalls.length).toBeGreaterThan(0);
      for (const call of progressCalls) {
        expect(call.dispatchId).toBe(customId);
      }
    });

    it('generates a UUID when no dispatchId is provided, and reuses it for all events', async () => {
      const device = createMockDevice();
      const service = new WakeAndLoadService({
        deviceService: createMockDeviceService(device),
        readinessPolicy: createMockReadinessPolicy(),
        broadcast: mockBroadcast,
        logger: mockLogger,
      });

      const result = await service.execute('living-room', { queue: 'morning-program' });

      expect(result.ok).toBe(true);
      expect(typeof result.dispatchId).toBe('string');
      expect(result.dispatchId.length).toBeGreaterThan(0);

      const progressCalls = mockBroadcast.mock.calls
        .map((args) => args[0])
        .filter((p) => p && p.type === 'wake-progress');

      expect(progressCalls.length).toBeGreaterThan(0);
      const first = progressCalls[0].dispatchId;
      for (const call of progressCalls) {
        expect(call.dispatchId).toBe(first);
      }
      expect(first).toBe(result.dispatchId);
    });

    it('exposes run() as an alias for execute()', async () => {
      const device = createMockDevice();
      const service = new WakeAndLoadService({
        deviceService: createMockDeviceService(device),
        readinessPolicy: createMockReadinessPolicy(),
        broadcast: mockBroadcast,
        logger: mockLogger,
      });

      const result = await service.run(
        'living-room',
        { queue: 'morning-program' },
        { dispatchId: 'run-path' },
      );

      expect(result.ok).toBe(true);
      expect(result.dispatchId).toBe('run-path');
    });
  });

  describe('adopt-snapshot mode (§4.7)', () => {
    function makeSnapshot() {
      return {
        sessionId: 'sess-1',
        state: 'playing',
        currentItem: { contentId: 'plex/123', format: 'video', title: 'Test' },
        position: 42,
        queue: { items: [], currentIndex: -1, upNextCount: 0 },
        config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1.0 },
        meta: { ownerId: 'tv-1', updatedAt: '2026-04-17T00:00:00.000Z' },
      };
    }

    it('replaces the load step with an adopt-snapshot command on adopt mode', async () => {
      const device = createMockDevice({
        prepareForContent: vi.fn(async () => ({ ok: true, coldRestart: false })),
        loadContent: vi.fn(async () => { throw new Error('must not be called on adopt'); }),
      });
      const sessionControlService = {
        sendCommand: vi.fn(async () => ({ ok: true, commandId: 'disp-xyz', appliedAt: 'now' })),
      };
      const service = new WakeAndLoadService({
        deviceService: createMockDeviceService(device),
        readinessPolicy: createMockReadinessPolicy(),
        broadcast: mockBroadcast,
        sessionControlService,
        logger: mockLogger,
      });

      const snapshot = makeSnapshot();
      const result = await service.execute(
        'living-room',
        {},
        { dispatchId: 'disp-xyz', adoptSnapshot: snapshot },
      );

      expect(result.ok).toBe(true);
      expect(result.dispatchId).toBe('disp-xyz');
      expect(result.steps.load).toMatchObject({ ok: true, method: 'adopt-snapshot', commandId: 'disp-xyz' });
      expect(device.loadContent).not.toHaveBeenCalled();
      expect(sessionControlService.sendCommand).toHaveBeenCalledTimes(1);
      const envelope = sessionControlService.sendCommand.mock.calls[0][0];
      expect(envelope).toMatchObject({
        type: 'command',
        command: 'adopt-snapshot',
        targetDevice: 'living-room',
        commandId: 'disp-xyz',
        params: { snapshot, autoplay: true },
      });

      const loadProgress = mockBroadcast.mock.calls
        .map((args) => args[0])
        .filter((p) => p && p.type === 'wake-progress' && p.step === 'load');
      expect(loadProgress.some((p) => p.method === 'adopt-snapshot' && p.status === 'done')).toBe(true);
    });

    it('returns a configuration error when adopt is requested without sessionControlService', async () => {
      const device = createMockDevice();
      const service = new WakeAndLoadService({
        deviceService: createMockDeviceService(device),
        readinessPolicy: createMockReadinessPolicy(),
        broadcast: mockBroadcast,
        logger: mockLogger,
        // no sessionControlService
      });

      const result = await service.execute(
        'living-room',
        {},
        { dispatchId: 'd1', adoptSnapshot: makeSnapshot() },
      );

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/adopt-snapshot/);
      expect(result.dispatchId).toBe('d1');
    });

    it('propagates an adopt-snapshot ack failure to the result', async () => {
      const device = createMockDevice({
        prepareForContent: vi.fn(async () => ({ ok: true, coldRestart: false })),
      });
      const sessionControlService = {
        sendCommand: vi.fn(async () => ({ ok: false, code: 'DEVICE_REFUSED', error: 'refused' })),
      };
      const service = new WakeAndLoadService({
        deviceService: createMockDeviceService(device),
        readinessPolicy: createMockReadinessPolicy(),
        broadcast: mockBroadcast,
        sessionControlService,
        logger: mockLogger,
      });

      const result = await service.execute(
        'living-room',
        {},
        { dispatchId: 'd-fail', adoptSnapshot: makeSnapshot() },
      );

      expect(result.ok).toBe(false);
      expect(result.failedStep).toBe('load');
      expect(result.steps.load).toMatchObject({ ok: false, method: 'adopt-snapshot', code: 'DEVICE_REFUSED' });
      expect(result.dispatchId).toBe('d-fail');
    });
  });
});
