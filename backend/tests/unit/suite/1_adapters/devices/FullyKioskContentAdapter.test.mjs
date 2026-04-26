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

    it('runs the camera check when no skipCameraCheck option is passed (default behavior)', async () => {
      const httpClient = createMockHttpClient();
      const mockAdb = {
        connect: vi.fn(async () => ({ ok: true })),
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

      const camCalls = mockAdb.shell.mock.calls.filter(
        ([cmd]) => cmd.includes('/dev/video') || cmd.includes('/dev/camera')
      );
      expect(camCalls.length).toBeGreaterThanOrEqual(1);
      expect(result.cameraAvailable).toBe(true);
      expect(result.cameraSkipped).toBeFalsy();
    });

    it('skips the camera check when skipCameraCheck:true is passed', async () => {
      const httpClient = createMockHttpClient();
      const mockAdb = {
        connect: vi.fn(async () => ({ ok: true })),
        shell: vi.fn(async (cmd) => {
          // Camera check would return 0 — but we expect it to NOT be called
          if (cmd.includes('/dev/video')) return { ok: true, output: '0' };
          return { ok: true, output: '' };
        }),
        launchActivity: vi.fn(async () => ({ ok: true })),
      };

      const adapter = new FullyKioskContentAdapter(
        { ...defaultConfig, launchActivity: 'de.ozerov.fully/.TvActivity' },
        { httpClient, logger: mockLogger, adbAdapter: mockAdb }
      );
      const result = await adapter.prepareForContent({ skipCameraCheck: true });

      const camCalls = mockAdb.shell.mock.calls.filter(
        ([cmd]) => cmd.includes('/dev/video') || cmd.includes('/dev/camera')
      );
      expect(camCalls.length).toBe(0);
      expect(result.cameraAvailable).toBeNull();
      expect(result.cameraSkipped).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'fullykiosk.prepareForContent.cameraCheck.skipped',
        expect.objectContaining({ reason: 'skipCameraCheck-flag' })
      );
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

  describe('load', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should succeed on first attempt when loadURL succeeds', async () => {
      // getDeviceInfo returns the URL the adapter built, so #verifyLoadedUrl
      // resolves on its first poll without ever hitting the inter-poll setTimeout
      // (which would hang under fake timers).
      const expectedUrl = 'http://localhost:3111/tv/screen?device=shield';
      const httpClient = {
        get: vi.fn(async (url) => {
          if (url.includes('cmd=getDeviceInfo')) {
            return { status: 200, data: JSON.stringify({ foreground: 'de.ozerov.fully', currentUrl: expectedUrl }) };
          }
          return { status: 200, data: '{}' };
        }),
      };
      const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });

      const result = await adapter.load('/tv/screen', { device: 'shield' });

      expect(result.ok).toBe(true);
      expect(result.attempt).toBe(1);
      expect(result.url).toContain('/tv/screen');
      expect(result.url).toContain('device=shield');
    });

    it('should retry and succeed on second attempt after transient failure', async () => {
      const expectedUrl = 'http://localhost:3111/tv/screen?device=shield';
      let callCount = 0;
      const httpClient = {
        get: vi.fn(async (url) => {
          if (url.includes('cmd=loadURL')) {
            callCount++;
            if (callCount === 1) {
              throw new Error('socket hang up');
            }
            return { status: 200, data: '{}' };
          }
          if (url.includes('cmd=getDeviceInfo')) {
            // Return matching currentUrl so verify resolves on first poll.
            return { status: 200, data: JSON.stringify({ foreground: 'de.ozerov.fully', currentUrl: expectedUrl }) };
          }
          return { status: 200, data: '{}' };
        }),
      };

      const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });

      const loadPromise = adapter.load('/tv/screen', { device: 'shield' });
      // Advance past the 1s backoff between attempt 1 and 2
      await vi.advanceTimersByTimeAsync(1500);
      const result = await loadPromise;

      expect(result.ok).toBe(true);
      expect(result.attempt).toBe(2);
      // First attempt failure should have been logged as a warn
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'fullykiosk.load.attemptFailed',
        expect.objectContaining({ attempt: 1 })
      );
    });

    it('should fail after exhausting all retries', async () => {
      const httpClient = {
        get: vi.fn(async (url) => {
          if (url.includes('cmd=loadURL')) {
            throw new Error('ECONNREFUSED');
          }
          if (url.includes('cmd=getDeviceInfo')) {
            return { status: 200, data: JSON.stringify({ foreground: 'de.ozerov.fully' }) };
          }
          return { status: 200, data: '{}' };
        }),
      };

      const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });

      const loadPromise = adapter.load('/tv/screen', { device: 'shield' });
      // Advance past all backoff delays: 1s + 2s between attempts
      await vi.advanceTimersByTimeAsync(1500);
      await vi.advanceTimersByTimeAsync(2500);
      const result = await loadPromise;

      expect(result.ok).toBe(false);
      expect(result.attempts).toBe(3);
      expect(result.error).toBe('ECONNREFUSED');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'fullykiosk.load.failed',
        expect.objectContaining({ attempts: 3 })
      );
    });
  });

  describe('load verifyAsync option', () => {
    // Real timers — verifyAsync path must not depend on the fake-timer machinery
    // used by the load-retry tests above.
    it('verifyAsync:true returns ok as soon as loadURL is acknowledged (no wait for verify poll)', async () => {
      // currentUrl never matches — under sync verify this would block ~10s.
      const httpClient = {
        get: vi.fn(async (url) => {
          if (url.includes('cmd=getDeviceInfo')) {
            return { status: 200, data: JSON.stringify({ foreground: 'de.ozerov.fully', currentUrl: 'about:blank' }) };
          }
          return { status: 200, data: '{}' };
        }),
      };

      const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });

      const start = Date.now();
      const result = await adapter.load('/tv/screen', { play: 'plex:1' }, { verifyAsync: true });
      const elapsed = Date.now() - start;

      expect(result.ok).toBe(true);
      expect(result.verified).toBe('async');
      // Provably did NOT wait for sync verification (sync would be ~10s minimum).
      expect(elapsed).toBeLessThan(1000);
    });

    it('verifyAsync:true logs async-verified (flat shape) on background success', async () => {
      const expectedUrl = 'http://localhost:3111/tv/screen?play=plex%3A1';
      const httpClient = {
        get: vi.fn(async (url) => {
          if (url.includes('cmd=getDeviceInfo')) {
            return { status: 200, data: JSON.stringify({ foreground: 'de.ozerov.fully', currentUrl: expectedUrl }) };
          }
          return { status: 200, data: '{}' };
        }),
      };

      const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });

      const result = await adapter.load('/tv/screen', { play: 'plex:1' }, { verifyAsync: true });
      expect(result.ok).toBe(true);
      expect(result.verified).toBe('async');

      // Drain the fire-and-forget promise — the success log fires when verify resolves.
      await new Promise(r => setTimeout(r, 50));
      expect(mockLogger.info).toHaveBeenCalledWith(
        'fullykiosk.load.async-verified',
        expect.objectContaining({ fullUrl: expectedUrl, verified: true, currentUrl: expectedUrl }),
      );
    });

    it('verifyAsync:true logs async-unverified (warn) when background verify reports unverified', async () => {
      // currentUrl never matches the loaded URL — verify will report unverified
      // after exhausting its 10s poll deadline. Use fake timers to fast-forward.
      vi.useFakeTimers();
      try {
        const httpClient = {
          get: vi.fn(async (url) => {
            if (url.includes('cmd=getDeviceInfo')) {
              return { status: 200, data: JSON.stringify({ foreground: 'de.ozerov.fully', currentUrl: 'about:blank' }) };
            }
            return { status: 200, data: '{}' };
          }),
        };

        const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });

        const loadPromise = adapter.load('/tv/screen', { play: 'plex:1' }, { verifyAsync: true });
        // load() returns immediately on ack under verifyAsync — no timer wait needed.
        const result = await loadPromise;
        expect(result.ok).toBe(true);
        expect(result.verified).toBe('async');

        // Now advance through the full 10s verify deadline so the fire-and-forget
        // promise resolves and the async-unverified log fires.
        await vi.advanceTimersByTimeAsync(11_000);

        expect(mockLogger.warn).toHaveBeenCalledWith(
          'fullykiosk.load.async-unverified',
          expect.objectContaining({ fullUrl: expect.any(String), verified: false }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('default (verifyAsync:false) preserves original sync verification behavior', async () => {
      // Mock returns a matching currentUrl so #verifyLoadedUrl resolves on the
      // first poll — no setTimeout needed, so this works under real timers too.
      const httpClient = {
        get: vi.fn(async (url) => {
          if (url.includes('cmd=getDeviceInfo')) {
            // Use the URL FullyKioskContentAdapter actually constructs:
            //   `${daylightHost}${path}?${query}`
            return { status: 200, data: JSON.stringify({ foreground: 'de.ozerov.fully', currentUrl: 'http://localhost:3111/tv/screen?device=shield' }) };
          }
          return { status: 200, data: '{}' };
        }),
      };

      const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });

      const result = await adapter.load('/tv/screen', { device: 'shield' });

      expect(result.ok).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.attempt).toBe(1);
    });
  });

  describe('loadStartUrl', () => {
    it('should send cmd=loadStartURL to the FKB host:port', async () => {
      const httpClient = createMockHttpClient();
      const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });

      const result = await adapter.loadStartUrl();

      expect(result.ok).toBe(true);

      // Verify exactly one loadStartURL call was made
      const calls = httpClient.get.mock.calls.map(c => c[0]);
      const loadStartUrlCalls = calls.filter(u => u.includes('cmd=loadStartURL'));
      expect(loadStartUrlCalls).toHaveLength(1);

      // Verify URL targets the configured host:port and includes password
      const url = loadStartUrlCalls[0];
      expect(url).toContain('http://10.0.0.11:2323/');
      expect(url).toContain('cmd=loadStartURL');
      expect(url).toContain('password=testpass');
    });

    it('should return {ok: false} when FKB returns non-2xx', async () => {
      const httpClient = createMockHttpClient({
        loadStartURL: { status: 500, data: 'Internal Server Error' },
      });
      const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });

      const result = await adapter.loadStartUrl();

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return {ok: false} when httpClient throws (e.g., ECONNREFUSED)', async () => {
      const httpClient = {
        get: vi.fn(async (url) => {
          if (url.includes('cmd=loadStartURL')) {
            throw new Error('ECONNREFUSED');
          }
          return { status: 200, data: '{}' };
        }),
      };
      const adapter = new FullyKioskContentAdapter(defaultConfig, { httpClient, logger: mockLogger });

      const result = await adapter.loadStartUrl();

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
