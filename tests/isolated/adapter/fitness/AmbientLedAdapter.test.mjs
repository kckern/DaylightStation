// tests/unit/adapters/fitness/AmbientLedAdapter.test.mjs
import { vi } from 'vitest';
import { AmbientLedAdapter } from "../../../../__app_modules/wellness/fitness/server/adapters/AmbientLedAdapter.mjs";

describe('AmbientLedAdapter', () => {
  let adapter;
  let mockGateway;
  let mockLoadFitnessConfig;
  let mockLogger;

  const defaultConfig = {
    ambient_led: {
      scenes: {
        off: 'scene.led_off',
        cool: 'scene.led_blue',
        active: 'scene.led_green',
        warm: 'scene.led_yellow',
        hot: 'scene.led_orange',
        fire: 'scene.led_red'
      },
      throttle_ms: 2000
    }
  };

  beforeEach(() => {
    mockGateway = {
      activateScene: vi.fn().mockResolvedValue({ ok: true })
    };
    mockLoadFitnessConfig = vi.fn().mockReturnValue(defaultConfig);
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    adapter = new AmbientLedAdapter({
      gateway: mockGateway,
      loadFitnessConfig: mockLoadFitnessConfig,
      logger: mockLogger
    });
  });

  describe('constructor', () => {
    test('throws without gateway', () => {
      expect(() => new AmbientLedAdapter({
        loadFitnessConfig: mockLoadFitnessConfig
      })).toThrow('requires gateway');
    });

    test('throws without loadFitnessConfig', () => {
      expect(() => new AmbientLedAdapter({
        gateway: mockGateway
      })).toThrow('requires loadFitnessConfig');
    });
  });

  describe('normalizeZoneId', () => {
    test('normalizes valid zone IDs', () => {
      expect(adapter.normalizeZoneId('COOL')).toBe('cool');
      expect(adapter.normalizeZoneId('Fire')).toBe('fire');
      expect(adapter.normalizeZoneId('  warm  ')).toBe('warm');
    });

    test('returns null for invalid zones', () => {
      expect(adapter.normalizeZoneId('invalid')).toBeNull();
      expect(adapter.normalizeZoneId(null)).toBeNull();
      expect(adapter.normalizeZoneId('')).toBeNull();
    });
  });

  describe('syncZone', () => {
    test('activates scene for active zones', async () => {
      const result = await adapter.syncZone({
        zones: [{ zoneId: 'warm', isActive: true }],
        sessionEnded: false,
        householdId: 'test-hid'
      });

      expect(result.ok).toBe(true);
      expect(result.scene).toBe('scene.led_yellow');
      expect(mockGateway.activateScene).toHaveBeenCalledWith('scene.led_yellow');
    });

    test('skips when feature disabled', async () => {
      mockLoadFitnessConfig.mockReturnValue({});

      const result = await adapter.syncZone({
        zones: [{ zoneId: 'warm', isActive: true }],
        householdId: 'test-hid'
      });

      expect(result.ok).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('feature_disabled');
      expect(mockGateway.activateScene).not.toHaveBeenCalled();
    });

    test('skips duplicate scene', async () => {
      // First call to set lastScene
      await adapter.syncZone({
        zones: [{ zoneId: 'warm', isActive: true }],
        householdId: 'test-hid'
      });

      // Reset mock for second call
      mockGateway.activateScene.mockClear();

      // Second call with same zone
      const result = await adapter.syncZone({
        zones: [{ zoneId: 'warm', isActive: true }],
        householdId: 'test-hid'
      });

      expect(result.ok).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('duplicate');
      expect(mockGateway.activateScene).not.toHaveBeenCalled();
    });

    test('does not skip when session ends', async () => {
      // Set lastScene to off
      adapter.lastScene = 'scene.led_off';
      adapter.lastActivatedAt = Date.now();

      const result = await adapter.syncZone({
        zones: [],
        sessionEnded: true,
        householdId: 'test-hid'
      });

      expect(result.ok).toBe(true);
      expect(mockGateway.activateScene).toHaveBeenCalled();
    });

    test('handles activation failure', async () => {
      mockGateway.activateScene.mockResolvedValue({ ok: false, error: 'HA error' });

      const result = await adapter.syncZone({
        zones: [{ zoneId: 'warm', isActive: true }],
        householdId: 'test-hid'
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('HA error');
      expect(adapter.failureCount).toBe(1);
    });

    test('enters backoff after max failures', async () => {
      mockGateway.activateScene.mockRejectedValue(new Error('HA error'));
      adapter.maxFailures = 2;

      // Trigger failures
      await adapter.syncZone({ zones: [{ zoneId: 'cool' }], householdId: 'hid' });
      await adapter.syncZone({ zones: [{ zoneId: 'warm' }], householdId: 'hid' });

      // Now should be in backoff
      mockGateway.activateScene.mockClear();
      const result = await adapter.syncZone({
        zones: [{ zoneId: 'hot' }],
        householdId: 'hid'
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('backoff');
      expect(mockGateway.activateScene).not.toHaveBeenCalled();
    });

    test('selects highest priority zone', async () => {
      const result = await adapter.syncZone({
        zones: [
          { zoneId: 'cool', isActive: true },
          { zoneId: 'hot', isActive: true },
          { zoneId: 'warm', isActive: true }
        ],
        householdId: 'test-hid'
      });

      expect(result.ok).toBe(true);
      expect(result.scene).toBe('scene.led_orange'); // hot is highest
    });

    test('returns off scene for empty zones', async () => {
      const result = await adapter.syncZone({
        zones: [],
        householdId: 'test-hid'
      });

      expect(result.ok).toBe(true);
      expect(result.scene).toBe('scene.led_off');
    });
  });

  describe('getStatus', () => {
    test('returns status when enabled', () => {
      adapter.lastScene = 'scene.led_blue';
      const status = adapter.getStatus('test-hid');

      expect(status.enabled).toBe(true);
      expect(status.scenes).toBeDefined();
      expect(status.state.lastScene).toBe('scene.led_blue');
    });

    test('returns disabled status when not configured', () => {
      mockLoadFitnessConfig.mockReturnValue({});
      const status = adapter.getStatus('test-hid');

      expect(status.enabled).toBe(false);
      expect(status.scenes).toBeNull();
    });

    test('includes grace period info in status', async () => {
      vi.useFakeTimers();

      // Trigger grace period
      await adapter.syncZone({ zones: [{ zoneId: 'warm', isActive: true }], sessionEnded: false, householdId: 'hid' });
      adapter.lastActivatedAt = 0;
      await adapter.syncZone({ zones: [], sessionEnded: false, householdId: 'hid' });

      const status = adapter.getStatus('hid');

      expect(status.state.gracePeriodActive).toBe(true);
      expect(status.state.gracePeriodStartedAt).toBeDefined();

      vi.useRealTimers();
    });
  });

  describe('getMetrics', () => {
    test('returns metrics data', async () => {
      await adapter.syncZone({ zones: [{ zoneId: 'warm', isActive: true }], householdId: 'hid' });
      // Reset lastActivatedAt to bypass rate limiting
      adapter.lastActivatedAt = 0;
      await adapter.syncZone({ zones: [{ zoneId: 'hot', isActive: true }], householdId: 'hid' });

      const metrics = adapter.getMetrics();

      expect(metrics.totals.requests).toBe(2);
      expect(metrics.totals.activated).toBe(2);
      expect(metrics.uptime.ms).toBeGreaterThanOrEqual(0);
      expect(metrics.sceneHistogram).toBeDefined();
    });

    test('tracks grace period metrics', async () => {
      vi.useFakeTimers();

      // Trigger grace period start
      await adapter.syncZone({ zones: [{ zoneId: 'warm', isActive: true }], sessionEnded: false, householdId: 'hid' });
      adapter.lastActivatedAt = 0;
      await adapter.syncZone({ zones: [], sessionEnded: false, householdId: 'hid' });

      // Cancel it by returning zones
      adapter.lastActivatedAt = 0;
      await adapter.syncZone({ zones: [{ zoneId: 'hot', isActive: true }], sessionEnded: false, householdId: 'hid' });

      const metrics = adapter.getMetrics();

      expect(metrics.gracePeriod.started).toBe(1);
      expect(metrics.gracePeriod.cancelled).toBe(1);

      vi.useRealTimers();
    });
  });

  describe('reset', () => {
    test('resets state', async () => {
      adapter.lastScene = 'scene.led_blue';
      adapter.failureCount = 3;
      adapter.backoffUntil = Date.now() + 60000;

      const result = adapter.reset();

      expect(result.ok).toBe(true);
      expect(result.previousState.lastScene).toBe('scene.led_blue');
      expect(adapter.lastScene).toBeNull();
      expect(adapter.failureCount).toBe(0);
      expect(adapter.backoffUntil).toBe(0);
    });

    test('clears grace period timer on reset', () => {
      vi.useFakeTimers();

      // Set up a grace timer
      adapter.graceTimer = setTimeout(() => {}, 30000);
      adapter.graceStartedAt = Date.now();

      const result = adapter.reset();

      expect(result.ok).toBe(true);
      expect(adapter.graceTimer).toBeNull();
      expect(adapter.graceStartedAt).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('grace period', () => {
    test('delays LED-off when zones become empty during active session', async () => {
      vi.useFakeTimers();

      // Activate with a zone first
      await adapter.syncZone({
        zones: [{ zoneId: 'warm', isActive: true }],
        sessionEnded: false,
        householdId: 'test-hid'
      });
      expect(adapter.lastScene).toBe('scene.led_yellow');
      mockGateway.activateScene.mockClear();

      // Now zones become empty (but session not ended) - should NOT immediately turn off
      adapter.lastActivatedAt = 0; // bypass rate limiting
      const result = await adapter.syncZone({
        zones: [],
        sessionEnded: false,
        householdId: 'test-hid'
      });

      expect(result.ok).toBe(true);
      expect(result.gracePeriodStarted).toBe(true);
      expect(mockGateway.activateScene).not.toHaveBeenCalled(); // Should NOT call off yet
      expect(adapter.lastScene).toBe('scene.led_yellow'); // Still showing previous scene

      vi.useRealTimers();
    });

    test('clears grace period when zones return', async () => {
      vi.useFakeTimers();

      // Activate, then zones empty
      await adapter.syncZone({ zones: [{ zoneId: 'warm', isActive: true }], sessionEnded: false, householdId: 'hid' });
      adapter.lastActivatedAt = 0;
      await adapter.syncZone({ zones: [], sessionEnded: false, householdId: 'hid' });

      expect(adapter.graceTimer).not.toBeNull();

      // Zones return - grace should clear
      adapter.lastActivatedAt = 0;
      mockGateway.activateScene.mockClear();
      const result = await adapter.syncZone({ zones: [{ zoneId: 'hot', isActive: true }], sessionEnded: false, householdId: 'hid' });

      expect(result.ok).toBe(true);
      expect(adapter.graceTimer).toBeNull();
      expect(adapter.graceStartedAt).toBeNull();
      expect(mockGateway.activateScene).toHaveBeenCalledWith('scene.led_orange');

      vi.useRealTimers();
    });

    test('turns off LED after grace period expires', async () => {
      vi.useFakeTimers();

      // Activate, then zones empty
      await adapter.syncZone({ zones: [{ zoneId: 'warm', isActive: true }], sessionEnded: false, householdId: 'hid' });
      adapter.lastActivatedAt = 0;
      await adapter.syncZone({ zones: [], sessionEnded: false, householdId: 'hid' });

      mockGateway.activateScene.mockClear();

      // Advance past grace period and flush pending promises
      vi.advanceTimersByTime(31000);
      await Promise.resolve(); // Flush microtask queue for async callback

      // Grace timer should have fired
      expect(mockGateway.activateScene).toHaveBeenCalledWith('scene.led_off');
      expect(adapter.lastScene).toBe('scene.led_off');

      vi.useRealTimers();
    });

    test('immediately turns off when session explicitly ends', async () => {
      vi.useFakeTimers();

      // Activate with zone
      await adapter.syncZone({ zones: [{ zoneId: 'warm', isActive: true }], sessionEnded: false, householdId: 'hid' });
      adapter.lastActivatedAt = 0;

      // Start grace period
      await adapter.syncZone({ zones: [], sessionEnded: false, householdId: 'hid' });
      expect(adapter.graceTimer).not.toBeNull();

      mockGateway.activateScene.mockClear();
      adapter.lastActivatedAt = 0;

      // Session ends - should immediately turn off and clear grace
      const result = await adapter.syncZone({ zones: [], sessionEnded: true, householdId: 'hid' });

      expect(result.ok).toBe(true);
      expect(result.scene).toBe('scene.led_off');
      expect(mockGateway.activateScene).toHaveBeenCalledWith('scene.led_off');
      expect(adapter.graceTimer).toBeNull();

      vi.useRealTimers();
    });

    test('does not start grace period when session ends', async () => {
      vi.useFakeTimers();

      // Activate with zone
      await adapter.syncZone({ zones: [{ zoneId: 'warm', isActive: true }], sessionEnded: false, householdId: 'hid' });
      adapter.lastActivatedAt = 0;
      mockGateway.activateScene.mockClear();

      // Session ends with empty zones - should turn off immediately, no grace
      const result = await adapter.syncZone({ zones: [], sessionEnded: true, householdId: 'hid' });

      expect(result.ok).toBe(true);
      expect(result.scene).toBe('scene.led_off');
      expect(result.gracePeriodStarted).toBeUndefined();
      expect(mockGateway.activateScene).toHaveBeenCalledWith('scene.led_off');

      vi.useRealTimers();
    });
  });

  describe('stale manual override before fire (dark mode)', () => {
    const darkConfig = {
      ambient_led: {
        ...defaultConfig.ambient_led,
        scenes: { ...defaultConfig.ambient_led.scenes, fire_all: 'scene.led_red_breathe' },
        dark_mode: {
          sensor: 'binary_sensor.dark_mode',
          manual_override: 'input_boolean.overhead_override',
          overhead_lights: ['light.overhead']
        }
      }
    };
    let calls;
    let states;

    beforeEach(() => {
      calls = [];
      states = { 'input_boolean.overhead_override': 'on', 'binary_sensor.dark_mode': 'off' };
      mockGateway = {
        getState: vi.fn(async (id) => ({ entityId: id, state: states[id], lastChanged: 't0' })),
        callService: vi.fn(async (domain, service, data) => {
          calls.push(`${domain}.${service}:${[].concat(data.entity_id).join(',')}`);
          return { ok: true };
        }),
        activateScene: vi.fn(async (scene) => { calls.push(`scene:${scene}`); return { ok: true }; })
      };
      mockLoadFitnessConfig = vi.fn().mockReturnValue(darkConfig);
      adapter = new AmbientLedAdapter({ gateway: mockGateway, loadFitnessConfig: mockLoadFitnessConfig, logger: mockLogger });
    });

    const sync = (zoneId) => adapter.syncZone({ zones: [{ zoneId, isActive: true }], householdId: 'h' });

    test('clears a stale override before the fire scene, then kills the overhead', async () => {
      await sync('hot');
      calls.length = 0;
      adapter.lastActivatedAt = 0; // past the throttle window
      await sync('fire');

      expect(calls).toEqual([
        'input_boolean.turn_off:input_boolean.overhead_override',
        'scene:scene.led_red_breathe',
        'light.turn_off:light.overhead'
      ]);
      expect(mockLogger.info).toHaveBeenCalledWith('fitness.zone_led.stale_override_cleared',
        expect.objectContaining({ entity: 'input_boolean.overhead_override', previousScene: 'scene.led_orange' }));
    });

    test('does not clear while already dark (fire -> fire_all, or override taken during dark)', async () => {
      await sync('fire');          // transition in: clears
      calls.length = 0;
      mockGateway.getState.mockClear();
      states['input_boolean.overhead_override'] = 'on'; // re-taken during dark mode
      adapter.lastActivatedAt = 0; // past the throttle window

      await adapter.syncZone({ zones: [{ zoneId: 'fire' }, { zoneId: 'hot' }], householdId: 'h' }); // fire (not all)
      expect(calls).toEqual(['scene:scene.led_red']);
      expect(mockGateway.getState).not.toHaveBeenCalled();
    });

    test('does not clear when dark mode is already on via another path', async () => {
      states['binary_sensor.dark_mode'] = 'on';
      await sync('fire');
      expect(calls).toEqual(['scene:scene.led_red_breathe']);
    });

    test('no-op when the override is off', async () => {
      states['input_boolean.overhead_override'] = 'off';
      await sync('fire');
      expect(calls).toEqual(['scene:scene.led_red_breathe']);
      expect(mockLogger.info).not.toHaveBeenCalledWith('fitness.zone_led.stale_override_cleared', expect.anything());
    });

    test('non-fire scenes never read or touch the override', async () => {
      await sync('hot');
      expect(mockGateway.getState).not.toHaveBeenCalled();
      expect(calls).toEqual(['scene:scene.led_orange']);
    });

    test('a failed clear still activates the fire scene', async () => {
      mockGateway.callService.mockResolvedValueOnce({ ok: false, error: 'boom' });
      const result = await sync('fire');
      expect(result.ok).toBe(true);
      expect(mockGateway.activateScene).toHaveBeenCalledWith('scene.led_red_breathe');
      expect(mockLogger.warn).toHaveBeenCalledWith('fitness.zone_led.stale_override_clear_failed', expect.anything());
    });
  });
});
