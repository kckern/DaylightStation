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

    it('should skip force-stop when mic is not blocked (happy path)', async () => {
      const httpClient = createMockHttpClient();

      const mockAdb = {
        connect: vi.fn(async () => ({ ok: true })),
        shell: vi.fn(async (cmd) => {
          // Camera check: return 1 video device
          if (cmd.includes('/dev/video')) return { ok: true, output: '1' };
          // dumpsys: no problematic services
          if (cmd.includes('dumpsys')) return { ok: true, output: 'no services running' };
          return { ok: true, output: '' };
        }),
        launchActivity: vi.fn(async () => ({ ok: true })),
      };

      const adapter = new FullyKioskContentAdapter(
        { ...defaultConfig, launchActivity: 'de.ozerov.fully/.TvActivity' },
        { httpClient, logger: mockLogger, adbAdapter: mockAdb }
      );
      const result = await adapter.prepareForContent();

      expect(result.ok).toBe(true);
      expect(result.coldRestart).toBe(false);

      // force-stop should NOT have been called
      const forceStopCalls = mockAdb.shell.mock.calls.filter(
        c => c[0].includes('force-stop')
      );
      expect(forceStopCalls).toHaveLength(0);
    });

    it('should force-stop and re-launch FKB when mic-blocking services are detected', async () => {
      const httpClient = createMockHttpClient();

      const mockAdb = {
        connect: vi.fn(async () => ({ ok: true })),
        shell: vi.fn(async (cmd) => {
          if (cmd.includes('/dev/video')) return { ok: true, output: '1' };
          if (cmd.includes('dumpsys')) {
            return { ok: true, output: '  * ServiceRecord{abc de.ozerov.fully/.service.SoundMeterService}\n' };
          }
          return { ok: true, output: '' };
        }),
        launchActivity: vi.fn(async () => ({ ok: true })),
      };

      const adapter = new FullyKioskContentAdapter(
        { ...defaultConfig, launchActivity: 'de.ozerov.fully/.TvActivity' },
        { httpClient, logger: mockLogger, adbAdapter: mockAdb }
      );
      const result = await adapter.prepareForContent();

      expect(result.ok).toBe(true);
      expect(result.coldRestart).toBe(true);

      // force-stop should have been called
      expect(mockAdb.shell).toHaveBeenCalledWith('am force-stop de.ozerov.fully');

      // re-launch should have been called
      expect(mockAdb.launchActivity).toHaveBeenCalledWith('de.ozerov.fully/.TvActivity');
    });

    it('should force-stop when MotionDetectorService is detected', async () => {
      const httpClient = createMockHttpClient();

      const mockAdb = {
        connect: vi.fn(async () => ({ ok: true })),
        shell: vi.fn(async (cmd) => {
          if (cmd.includes('/dev/video')) return { ok: true, output: '1' };
          if (cmd.includes('dumpsys')) {
            return { ok: true, output: '  * ServiceRecord{def de.ozerov.fully/.service.MotionDetectorService}\n' };
          }
          return { ok: true, output: '' };
        }),
        launchActivity: vi.fn(async () => ({ ok: true })),
      };

      const adapter = new FullyKioskContentAdapter(
        { ...defaultConfig, launchActivity: 'de.ozerov.fully/.TvActivity' },
        { httpClient, logger: mockLogger, adbAdapter: mockAdb }
      );
      const result = await adapter.prepareForContent();

      expect(result.ok).toBe(true);
      expect(result.coldRestart).toBe(true);

      // force-stop should have been called
      expect(mockAdb.shell).toHaveBeenCalledWith('am force-stop de.ozerov.fully');

      // re-launch should have been called
      expect(mockAdb.launchActivity).toHaveBeenCalledWith('de.ozerov.fully/.TvActivity');
    });

    it('should skip ADB restart when no adbAdapter provided', async () => {
      const httpClient = createMockHttpClient();

      const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });
      const result = await adapter.prepareForContent();

      expect(result.ok).toBe(true);
      // No ADB calls — just verify it completes normally
    });

    it('should skip mic check and force-stop when ADB connect fails', async () => {
      const httpClient = createMockHttpClient();
      const mockAdb = {
        connect: vi.fn(async () => ({ ok: false, error: 'ADB offline' })),
        shell: vi.fn(async (cmd) => {
          if (cmd.includes('/dev/video')) return { ok: true, output: '1' };
          return { ok: true, output: '' };
        }),
        launchActivity: vi.fn(async () => ({ ok: true })),
      };

      const adapter = new FullyKioskContentAdapter(
        { ...defaultConfig, launchActivity: 'de.ozerov.fully/.TvActivity' },
        { httpClient, logger: mockLogger, adbAdapter: mockAdb }
      );
      const result = await adapter.prepareForContent();

      expect(result.ok).toBe(true);
      expect(result.coldRestart).toBe(false);

      // force-stop should NOT have been called since ADB connect failed
      const forceStopCalls = mockAdb.shell.mock.calls.filter(
        c => c[0].includes('force-stop')
      );
      expect(forceStopCalls).toHaveLength(0);
    });
  });
});
