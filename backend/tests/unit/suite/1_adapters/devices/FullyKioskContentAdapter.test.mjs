import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FullyKioskContentAdapter } from '#adapters/devices/FullyKioskContentAdapter.mjs';

describe('FullyKioskContentAdapter', () => {
  let mockLogger;

  const defaultConfig = {
    host: '10.0.0.11',
    port: 2323,
    password: 'testpass',
    daylightHost: 'http://localhost:3111',
  };

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  function createMockHttpClient(overrides = {}) {
    return {
      get: vi.fn(async (url) => {
        const cmd = url.match(/[?&]cmd=([^&]+)/)?.[1];
        const key = url.match(/[?&]key=([^&]+)/)?.[1];
        const lookup = key ? `${cmd}:${key}` : cmd;
        if (overrides[lookup]) return overrides[lookup];
        if (cmd === 'getDeviceInfo') {
          return { status: 200, data: JSON.stringify({ foreground: 'de.ozerov.fully' }) };
        }
        return { status: 200, data: '{}' };
      }),
    };
  }

  describe('prepareForContent', () => {
    it('should send setBooleanSetting for three FKB services after screenOn', async () => {
      const callOrder = [];
      const httpClient = {
        get: vi.fn(async (url) => {
          const cmd = url.match(/[?&]cmd=([^&]+)/)?.[1];
          const key = url.match(/[?&]key=([^&]+)/)?.[1];
          callOrder.push(key ? `${cmd}:${key}` : cmd);
          if (cmd === 'getDeviceInfo') {
            return { status: 200, data: JSON.stringify({ foreground: 'de.ozerov.fully' }) };
          }
          return { status: 200, data: '{}' };
        }),
      };

      const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });
      const result = await adapter.prepareForContent();

      expect(result.ok).toBe(true);

      // Verify three setBooleanSetting calls exist
      const settingCalls = httpClient.get.mock.calls.map(c => c[0]).filter(u => u.includes('cmd=setBooleanSetting'));
      expect(settingCalls).toHaveLength(3);

      // Verify correct settings and values
      const settings = settingCalls.map(url => ({
        key: url.match(/key=([^&]+)/)[1],
        value: url.match(/value=([^&]+)/)[1],
      }));
      expect(settings).toEqual([
        { key: 'motionDetection', value: 'false' },
        { key: 'motionDetectionAcoustic', value: 'false' },
        { key: 'acousticScreenOn', value: 'false' },
      ]);

      // Verify password included
      for (const url of settingCalls) {
        expect(url).toContain('password=testpass');
      }

      // Verify ordering: screenOn → settings → toForeground
      const screenIdx = callOrder.indexOf('screenOn');
      const firstSettingIdx = callOrder.indexOf('setBooleanSetting:motionDetection');
      const lastSettingIdx = callOrder.indexOf('setBooleanSetting:acousticScreenOn');
      const fgIdx = callOrder.indexOf('toForeground');
      expect(screenIdx).toBeLessThan(firstSettingIdx);
      expect(lastSettingIdx).toBeLessThan(fgIdx);
    });

    it('should succeed even if a setBooleanSetting call fails', async () => {
      const httpClient = createMockHttpClient({
        'setBooleanSetting:motionDetectionAcoustic': { status: 500, data: 'error' },
      });

      const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });
      const result = await adapter.prepareForContent();

      expect(result.ok).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'fullykiosk.prepareForContent.disableSetting.failed',
        expect.objectContaining({ setting: 'motionDetectionAcoustic' }),
      );
    });

    it('should not send settings if screenOn fails', async () => {
      const httpClient = {
        get: vi.fn(async (url) => {
          if (url.includes('cmd=screenOn')) throw new Error('ECONNREFUSED');
          return { status: 200, data: '{}' };
        }),
      };

      const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });
      const result = await adapter.prepareForContent();

      expect(result.ok).toBe(false);
      const settingCalls = httpClient.get.mock.calls.map(c => c[0]).filter(u => u.includes('setBooleanSetting'));
      expect(settingCalls).toHaveLength(0);
    });
  });
});
