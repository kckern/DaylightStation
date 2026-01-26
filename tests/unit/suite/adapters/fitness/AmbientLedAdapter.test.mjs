// tests/unit/adapters/fitness/AmbientLedAdapter.test.mjs
import { jest } from '@jest/globals';
import { AmbientLedAdapter } from '#backend/src/2_adapters/fitness/AmbientLedAdapter.mjs';

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
      activateScene: jest.fn().mockResolvedValue({ ok: true })
    };
    mockLoadFitnessConfig = jest.fn().mockReturnValue(defaultConfig);
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
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
  });

  describe('grace period', () => {
    test('delays LED-off when zones become empty during active session', async () => {
      jest.useFakeTimers();

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

      jest.useRealTimers();
    });
  });
});
