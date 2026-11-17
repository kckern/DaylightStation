import { describe, expect, it, vi } from 'vitest';
import { DaylightAndroidContentAdapter } from './DaylightAndroidContentAdapter.mjs';
import { isContentControl } from '#apps/devices/ports/IContentControl.mjs';

const ok = (data = {}) => ({ ok: true, data: { ok: true, ...data } });
const fail = (code, error = code) => ({ ok: false, code, error });

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * A rest client whose answers come from a `"METHOD /route"` table. A table
 * entry may be a result or a function of the request. Unlisted routes answer
 * `ok`, and every request is recorded in order.
 */
function makeRest(table = {}) {
  const calls = [];
  const answer = (method) => async (route, a, b) => {
    const body = method === 'POST' ? a : undefined;
    const options = method === 'POST' ? b : a;
    calls.push({ method, route, body, options });
    const entry = table[`${method} ${route}`];
    return typeof entry === 'function' ? entry({ body, options, calls }) : (entry ?? ok());
  };
  return { get: vi.fn(answer('GET')), post: vi.fn(answer('POST')), delete: vi.fn(answer('DELETE')), calls };
}

const routes = rest => rest.calls.map(call => `${call.method} ${call.route}`);

function makeAdapter(table = {}, { adbAdapter, config = {}, logger = makeLogger() } = {}) {
  const rest = makeRest(table);
  const sleep = vi.fn(async () => {});
  const adapter = new DaylightAndroidContentAdapter(
    { host: 'kiosk.test', port: 8780, token: 'tok', daylightHost: 'https://daylight.test', ...config },
    { restClient: rest, logger, adbAdapter, sleep },
  );
  return { adapter, rest, logger, sleep };
}

describe('DaylightAndroidContentAdapter', () => {
  it('implements IContentControl and needs a transport', () => {
    const { adapter } = makeAdapter();
    expect(isContentControl(adapter)).toBe(true);
    expect(() => new DaylightAndroidContentAdapter({ host: 'kiosk.test' }, {})).toThrow(/httpClient/);
  });

  it('builds its own rest client from an http client and sends the token as a header', async () => {
    const httpClient = {
      get: vi.fn(async () => ({ status: 200, data: { ok: true, ready: true } })),
      post: vi.fn(),
      delete: vi.fn(),
    };
    const adapter = new DaylightAndroidContentAdapter(
      { host: 'kiosk.test', port: 8780, token: 'tok', daylightHost: 'https://daylight.test' },
      { httpClient, logger: makeLogger() },
    );
    await adapter.getStatus();
    const [url, config] = httpClient.get.mock.calls[0];
    expect(url).toMatch(/^http:\/\/kiosk\.test:8780\//);
    expect(url).not.toContain('tok');
    expect(config.headers['X-Daylight-Token']).toBe('tok');
  });

  describe('load', () => {
    it('posts the full URL and reports the confirmed load', async () => {
      const { adapter, rest } = makeAdapter({
        'POST /kiosk/load': ({ body }) => ok({ url: body.url, loaded: true, loadTimeMs: 840 }),
      });

      const result = await adapter.load('/screen/living-room', { queue: 'plex:1', shuffle: '1' });

      expect(rest.calls).toHaveLength(1);
      expect(rest.calls[0].body).toEqual({ url: 'https://daylight.test/screen/living-room?queue=plex%3A1&shuffle=1' });
      expect(result).toMatchObject({
        ok: true,
        url: 'https://daylight.test/screen/living-room?queue=plex%3A1&shuffle=1',
        attempt: 1,
        verified: true,
      });
      expect(typeof result.loadTimeMs).toBe('number');
    });

    it('omits the question mark when there is no query', async () => {
      const { adapter, rest } = makeAdapter();
      await adapter.load('/piano');
      expect(rest.calls[0].body).toEqual({ url: 'https://daylight.test/piano' });
    });

    it('gives the request longer than the device waits for the page', async () => {
      const { adapter, rest } = makeAdapter();
      await adapter.load('/piano');
      expect(rest.calls[0].options.timeout).toBeGreaterThan(20_000);
    });

    it('without verifyAsync sends no wait flag and waits for the page', async () => {
      const { adapter, rest } = makeAdapter();
      await adapter.load('/piano');
      expect(rest.calls[0].body).not.toHaveProperty('wait');
      expect(routes(rest)).toEqual(['POST /kiosk/load']);
    });

    describe('verifyAsync', () => {
      const URL_ = 'https://daylight.test/piano?queue=plex%3A1';
      const accepted = { 'POST /kiosk/load': ({ body }) => ok({ accepted: true, url: body.url }) };

      it('sends wait:false and returns on the acknowledgement', async () => {
        const { adapter, rest } = makeAdapter({
          ...accepted,
          'GET /kiosk/status': ok({ lastLoad: { url: URL_, ok: true, atMs: 5 } }),
        });

        const result = await adapter.load('/piano', { queue: 'plex:1' }, { verifyAsync: true });

        expect(rest.calls[0]).toMatchObject({ method: 'POST', route: '/kiosk/load', body: { url: URL_, wait: false } });
        // No long page-load timeout: the client's default applies.
        expect(rest.calls[0].options?.timeout ?? 10_000).toBeLessThanOrEqual(10_000);
        expect(result).toMatchObject({ ok: true, url: URL_, attempt: 1, verified: 'async' });
        expect(typeof result.loadTimeMs).toBe('number');
      });

      it('logs async-verified once lastLoad reports the URL loaded', async () => {
        let polls = 0;
        const { adapter, logger, sleep } = makeAdapter({
          ...accepted,
          'GET /kiosk/status': () => (++polls < 3
            ? ok({ currentUrl: 'https://daylight.test/old', lastLoad: { url: 'https://daylight.test/old', ok: true, atMs: 1 } })
            // Reported decoded and with a trailing slash difference: still the same page.
            : ok({ currentUrl: 'https://daylight.test/piano?queue=plex:1', lastLoad: { url: 'https://daylight.test/piano?queue=plex:1', ok: true, atMs: 9 } })),
        });

        await adapter.load('/piano', { queue: 'plex:1' }, { verifyAsync: true });

        await vi.waitFor(() => expect(logger.info).toHaveBeenCalledWith('daylightandroid.load.async-verified', {
          fullUrl: URL_,
          verified: true,
          currentUrl: 'https://daylight.test/piano?queue=plex:1',
          reason: undefined,
        }));
        expect(polls).toBe(3);
        expect(sleep).toHaveBeenCalledWith(500);
        expect(logger.warn).not.toHaveBeenCalledWith('daylightandroid.load.async-unverified', expect.anything());
      });

      it('logs async-unverified with the device error when the page failed to load', async () => {
        const { adapter, logger } = makeAdapter({
          ...accepted,
          'GET /kiosk/status': ok({ currentUrl: 'about:blank', lastLoad: { url: URL_, ok: false, error: 'net::ERR_CONNECTION_REFUSED', atMs: 9 } }),
        });

        const result = await adapter.load('/piano', { queue: 'plex:1' }, { verifyAsync: true });

        expect(result.ok).toBe(true);
        await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith('daylightandroid.load.async-unverified', {
          fullUrl: URL_,
          verified: false,
          currentUrl: 'about:blank',
          reason: 'net::ERR_CONNECTION_REFUSED',
        }));
      });

      it('logs async-unverified when lastLoad never reports the URL', async () => {
        let polls = 0;
        const { adapter, logger } = makeAdapter({
          ...accepted,
          'GET /kiosk/status': () => { polls++; return ok({ currentUrl: 'https://daylight.test/old', lastLoad: { url: 'https://daylight.test/old', ok: true } }); },
        });

        await adapter.load('/piano', { queue: 'plex:1' }, { verifyAsync: true });

        await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith('daylightandroid.load.async-unverified', {
          fullUrl: URL_,
          verified: false,
          currentUrl: 'https://daylight.test/old',
          reason: 'lastLoad never reported this URL',
        }));
        expect(polls).toBe(50);
      });

      it('keeps polling through a status read that fails', async () => {
        let polls = 0;
        const { adapter, logger } = makeAdapter({
          ...accepted,
          'GET /kiosk/status': () => (++polls < 2 ? fail('TIMEOUT', 'timeout') : ok({ lastLoad: { url: URL_, ok: true } })),
        });
        await adapter.load('/piano', { queue: 'plex:1' }, { verifyAsync: true });
        await vi.waitFor(() => expect(logger.info).toHaveBeenCalledWith('daylightandroid.load.async-verified', expect.any(Object)));
      });

      it('logs async-verify-failed when the verification itself throws', async () => {
        const { adapter, rest, logger } = makeAdapter(accepted);
        rest.get.mockRejectedValue(new Error('boom'));

        const result = await adapter.load('/piano', { queue: 'plex:1' }, { verifyAsync: true });

        expect(result.ok).toBe(true);
        await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith('daylightandroid.load.async-verify-failed', {
          fullUrl: URL_, error: 'boom',
        }));
      });

      describe('with a loadId in the acknowledgement', () => {
        const withId = { 'POST /kiosk/load': ({ body }) => ok({ accepted: true, url: body.url, loadId: 'L2' }) };

        it('does not accept an earlier load of the same URL', async () => {
          let polls = 0;
          const { adapter, logger } = makeAdapter({
            ...withId,
            'GET /kiosk/status': () => (++polls < 3
              ? ok({ currentUrl: URL_, lastLoad: { loadId: 'L1', url: URL_, ok: true, atMs: 1 } })
              : ok({ currentUrl: URL_, lastLoad: { loadId: 'L2', url: URL_, ok: true, atMs: 9 } })),
          });

          await adapter.load('/piano', { queue: 'plex:1' }, { verifyAsync: true });

          await vi.waitFor(() => expect(logger.info).toHaveBeenCalledWith('daylightandroid.load.async-verified', {
            fullUrl: URL_, verified: true, currentUrl: URL_, reason: undefined,
          }));
          expect(polls).toBe(3);
          expect(logger.warn).not.toHaveBeenCalledWith('daylightandroid.load.async-verify-url-fallback', expect.anything());
        });

        it('matches on the id even when the device reports the URL differently', async () => {
          const { adapter, logger } = makeAdapter({
            ...withId,
            'GET /kiosk/status': ok({ currentUrl: 'https://daylight.test/redirected', lastLoad: { loadId: 'L2', url: 'https://daylight.test/redirected', ok: true } }),
          });
          await adapter.load('/piano', { queue: 'plex:1' }, { verifyAsync: true });
          await vi.waitFor(() => expect(logger.info).toHaveBeenCalledWith('daylightandroid.load.async-verified', expect.objectContaining({ verified: true })));
        });

        it('reports the failure of that load', async () => {
          const { adapter, logger } = makeAdapter({
            ...withId,
            'GET /kiosk/status': ok({ currentUrl: 'about:blank', lastLoad: { loadId: 'L2', url: URL_, ok: false, error: 'net::ERR_TIMED_OUT' } }),
          });
          await adapter.load('/piano', { queue: 'plex:1' }, { verifyAsync: true });
          await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith('daylightandroid.load.async-unverified', {
            fullUrl: URL_, verified: false, currentUrl: 'about:blank', reason: 'net::ERR_TIMED_OUT',
          }));
        });

        it('is unverified when lastLoad never carries the id, even though the URL matches', async () => {
          const { adapter, logger } = makeAdapter({
            ...withId,
            'GET /kiosk/status': ok({ currentUrl: URL_, lastLoad: { loadId: 'L1', url: URL_, ok: true } }),
          });
          await adapter.load('/piano', { queue: 'plex:1' }, { verifyAsync: true });
          await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith('daylightandroid.load.async-unverified', {
            fullUrl: URL_, verified: false, currentUrl: URL_, reason: 'lastLoad never reported this load',
          }));
        });
      });

      it('falls back to matching the URL, and says so, when the acknowledgement has no loadId', async () => {
        const { adapter, logger } = makeAdapter({
          ...accepted,
          'GET /kiosk/status': ok({ currentUrl: URL_, lastLoad: { loadId: 'L7', url: URL_, ok: true } }),
        });
        await adapter.load('/piano', { queue: 'plex:1' }, { verifyAsync: true });
        expect(logger.warn).toHaveBeenCalledWith('daylightandroid.load.async-verify-url-fallback', { fullUrl: URL_ });
        await vi.waitFor(() => expect(logger.info).toHaveBeenCalledWith('daylightandroid.load.async-verified', expect.objectContaining({ verified: true })));
      });

      it('a refused acknowledgement fails the load and starts no verification', async () => {
        const { adapter, rest } = makeAdapter({ 'POST /kiosk/load': fail('COMMAND_REJECTED', 'Command was rejected: bad_request') });
        const result = await adapter.load('/piano', {}, { verifyAsync: true });
        expect(result).toMatchObject({ ok: false, error: 'Command was rejected: bad_request', attempts: 1 });
        expect(routes(rest)).toEqual(['POST /kiosk/load']);
      });
    });

    it('reports a load the device refused without retrying', async () => {
      const { adapter, rest, sleep } = makeAdapter({
        'POST /kiosk/load': fail('COMMAND_REJECTED', 'Command was rejected: net::ERR_NAME_NOT_RESOLVED'),
      });

      const result = await adapter.load('/piano');

      expect(rest.calls).toHaveLength(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ok: false,
        url: 'https://daylight.test/piano',
        error: 'Command was rejected: net::ERR_NAME_NOT_RESOLVED',
        attempts: 1,
      });
      expect(adapter.getMetrics().errors).toBe(1);
    });

    it('retries an unreachable device with backoff and succeeds when it returns', async () => {
      let attempt = 0;
      const { adapter, rest, sleep } = makeAdapter({
        'POST /kiosk/load': () => (++attempt < 3 ? fail('UNREACHABLE', 'connect ECONNREFUSED') : ok({ loaded: true })),
      });

      const result = await adapter.load('/piano');

      expect(rest.calls).toHaveLength(3);
      expect(sleep.mock.calls.map(call => call[0])).toEqual([1000, 2000]);
      expect(result).toMatchObject({ ok: true, attempt: 3 });
    });

    it('gives up after three unreachable attempts', async () => {
      const { adapter, rest, logger } = makeAdapter({
        'POST /kiosk/load': fail('UNREACHABLE', 'connect ECONNREFUSED'),
      });

      const result = await adapter.load('/piano');

      expect(rest.calls).toHaveLength(3);
      expect(result).toMatchObject({ ok: false, error: 'connect ECONNREFUSED', attempts: 3 });
      expect(logger.error).toHaveBeenCalledWith('daylightandroid.load.failed', expect.any(Object));
    });
  });

  it('loadStartUrl posts /kiosk/load-start', async () => {
    const good = makeAdapter();
    await expect(good.adapter.loadStartUrl()).resolves.toEqual({ ok: true });
    expect(routes(good.rest)).toEqual(['POST /kiosk/load-start']);

    const bad = makeAdapter({ 'POST /kiosk/load-start': fail('TIMEOUT', 'timeout') });
    await expect(bad.adapter.loadStartUrl()).resolves.toEqual({ ok: false, error: 'timeout' });
  });

  describe('screen', () => {
    it('screenOn and screenOff post the wanted state', async () => {
      const { adapter, rest } = makeAdapter({
        'POST /screen': ({ body }) => ok({ screenOn: body.on }),
      });

      await expect(adapter.screenOn()).resolves.toEqual({ ok: true });
      await expect(adapter.screenOff()).resolves.toEqual({ ok: true });

      expect(rest.calls.map(call => call.body)).toEqual([{ on: true }, { on: false }]);
    });

    it('fails when the display did not reach the wanted state', async () => {
      const { adapter } = makeAdapter({ 'POST /screen': ok({ screenOn: false }) });
      const result = await adapter.screenOn();
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/screen/i);
    });

    it('passes a transport failure through', async () => {
      const { adapter } = makeAdapter({ 'POST /screen': fail('UNREACHABLE', 'connect ECONNREFUSED') });
      await expect(adapter.screenOff()).resolves.toEqual({ ok: false, error: 'connect ECONNREFUSED' });
    });
  });

  describe('getStatus', () => {
    it('reports the fields callers read, under their existing names', async () => {
      const { adapter } = makeAdapter({
        'GET /kiosk/status': ok({ ready: true, currentUrl: 'https://daylight.test/piano', screenOn: true, foreground: 'net.example.kiosk' }),
        'GET /status': ok({ device: 'piano-tablet', appVersion: '2.1.0', payloadVersion: '1.4.0', shellVersionCode: 7 }),
      });

      await expect(adapter.getStatus()).resolves.toEqual({
        ready: true,
        provider: 'daylight-android',
        currentUrl: 'https://daylight.test/piano',
        screenOn: true,
        appVersion: '2.1.0',
      });
    });

    it('falls back to the payload version when the shell reports no appVersion', async () => {
      const { adapter } = makeAdapter({
        'GET /kiosk/status': ok({ ready: true }),
        'GET /status': ok({ payloadVersion: '1.4.0' }),
      });
      await expect(adapter.getStatus()).resolves.toMatchObject({ appVersion: '1.4.0' });
    });

    it('still reports status when the version read fails', async () => {
      const { adapter } = makeAdapter({
        'GET /kiosk/status': ok({ ready: true, currentUrl: 'u', screenOn: false }),
        'GET /status': fail('TIMEOUT', 'timeout'),
      });
      await expect(adapter.getStatus()).resolves.toMatchObject({
        ready: true, provider: 'daylight-android', screenOn: false, appVersion: undefined,
      });
    });

    it('passes on a kiosk that says its WebView is not ready', async () => {
      const { adapter } = makeAdapter({ 'GET /kiosk/status': ok({ ready: false, screenOn: true }) });
      await expect(adapter.getStatus()).resolves.toMatchObject({ ready: false, provider: 'daylight-android' });
    });

    it('is not ready, with the error, when the device does not answer', async () => {
      const { adapter } = makeAdapter({ 'GET /kiosk/status': fail('UNREACHABLE', 'connect ECONNREFUSED') });
      await expect(adapter.getStatus()).resolves.toEqual({
        ready: false, provider: 'daylight-android', error: 'connect ECONNREFUSED',
      });
    });

    it('is not ready when the client throws', async () => {
      const { adapter, rest } = makeAdapter();
      rest.get.mockRejectedValue(new Error('boom'));
      await expect(adapter.getStatus()).resolves.toEqual({
        ready: false, provider: 'daylight-android', error: 'boom',
      });
    });
  });

  describe('prepareForContent', () => {
    const screenUp = { 'POST /screen': ok({ screenOn: true }) };
    const adb = (count = '2\n') => ({
      connect: vi.fn(async () => ({ ok: true })),
      shell: vi.fn(async () => ({ ok: true, output: count })),
      reboot: vi.fn(async () => ({ ok: true })),
    });

    it('wakes the screen first and stops there when that fails', async () => {
      const { adapter, rest } = makeAdapter({ 'POST /screen': fail('UNREACHABLE', 'connect ECONNREFUSED') });

      const result = await adapter.prepareForContent();

      expect(routes(rest)).toEqual(['POST /screen']);
      expect(rest.calls[0].body).toEqual({ on: true });
      expect(result).toEqual({ ok: false, step: 'screenOn', error: 'connect ECONNREFUSED' });
    });

    it('fails at toForeground when the kiosk cannot be brought to the front', async () => {
      const { adapter, rest } = makeAdapter({
        ...screenUp,
        'POST /kiosk/foreground': fail('COMMAND_REJECTED', 'Command was rejected: foreground is org.example.other'),
      });

      const result = await adapter.prepareForContent();

      expect(routes(rest)).toEqual(['POST /screen', 'POST /kiosk/foreground']);
      expect(result).toMatchObject({ ok: false, step: 'toForeground' });
      expect(result.error).toContain('org.example.other');
    });

    it('names rejected credentials at the foreground step', async () => {
      const { adapter } = makeAdapter({
        ...screenUp,
        'POST /kiosk/foreground': fail('AUTH_REJECTED', 'HTTP 401: unauthorized'),
      });
      const result = await adapter.prepareForContent();
      expect(result.step).toBe('toForeground');
      expect(result.error).toMatch(/rejected credentials/i);
    });

    it('broadcast profile wakes and foregrounds, and does nothing else', async () => {
      const adbAdapter = adb();
      const { adapter, rest } = makeAdapter(screenUp, { adbAdapter });

      const result = await adapter.prepareForContent({ profile: 'broadcast' });

      expect(routes(rest)).toEqual(['POST /screen', 'POST /kiosk/foreground']);
      expect(adbAdapter.connect).not.toHaveBeenCalled();
      expect(adbAdapter.shell).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        ok: true,
        profile: 'broadcast',
        coldRestart: false,
        cameraAvailable: null,
        cameraSkipped: true,
        foregroundVerified: true,
      });
      expect(typeof result.elapsedMs).toBe('number');
    });

    it('full profile on a device without mic-bridge leaves the mic routes alone', async () => {
      const { adapter, rest } = makeAdapter({
        ...screenUp,
        'GET /capabilities': ok({ capabilities: ['webview-host', 'screen-power'], routes: [] }),
      });

      const result = await adapter.prepareForContent({ skipCameraCheck: true });

      expect(routes(rest)).toEqual(['POST /screen', 'POST /kiosk/foreground', 'GET /capabilities']);
      expect(result).toMatchObject({ ok: true, coldRestart: false, cameraAvailable: null, cameraSkipped: true });
    });

    it('full profile with mic-bridge checks the mic and leaves a free mic alone', async () => {
      const { adapter, rest } = makeAdapter({
        ...screenUp,
        'GET /capabilities': ok({ capabilities: ['webview-host', 'mic-bridge'] }),
        'GET /mic/status': ok({ heldByOther: false }),
      });

      const result = await adapter.prepareForContent({ skipCameraCheck: true });

      expect(routes(rest)).toEqual([
        'POST /screen', 'POST /kiosk/foreground', 'GET /capabilities', 'GET /mic/status',
      ]);
      expect(result).toMatchObject({ ok: true, micRestarted: false });
    });

    it('restarts the mic bridge when another process holds the mic', async () => {
      const { adapter, rest } = makeAdapter({
        ...screenUp,
        'GET /capabilities': ok({ capabilities: ['mic-bridge'] }),
        'GET /mic/status': ok({ heldByOther: true, holder: 'org.example.other' }),
      });

      const result = await adapter.prepareForContent({ skipCameraCheck: true });

      expect(routes(rest)).toEqual([
        'POST /screen', 'POST /kiosk/foreground', 'GET /capabilities', 'GET /mic/status', 'POST /mic/restart',
      ]);
      expect(result).toMatchObject({ ok: true, micRestarted: true });
    });

    it('a failed mic check or restart is logged and does not fail the prepare', async () => {
      const unknown = makeAdapter({ ...screenUp, 'GET /capabilities': fail('TIMEOUT', 'timeout') });
      await expect(unknown.adapter.prepareForContent({ skipCameraCheck: true })).resolves.toMatchObject({ ok: true });
      expect(unknown.logger.warn).toHaveBeenCalledWith('daylightandroid.prepareForContent.capabilities.failed', expect.any(Object));

      const stuck = makeAdapter({
        ...screenUp,
        'GET /capabilities': ok({ capabilities: ['mic-bridge'] }),
        'GET /mic/status': ok({ heldByOther: true }),
        'POST /mic/restart': fail('HTTP_ERROR', 'HTTP 500: internal'),
      });
      await expect(stuck.adapter.prepareForContent({ skipCameraCheck: true })).resolves.toMatchObject({
        ok: true, micRestarted: false,
      });
      expect(stuck.logger.warn).toHaveBeenCalledWith('daylightandroid.prepareForContent.micRestart.failed', expect.any(Object));
    });

    it('never force-stops or relaunches anything over ADB', async () => {
      const adbAdapter = adb();
      adbAdapter.launchActivity = vi.fn();
      const { adapter } = makeAdapter({
        ...screenUp,
        'GET /capabilities': ok({ capabilities: ['mic-bridge'] }),
        'GET /mic/status': ok({ heldByOther: true }),
      }, { adbAdapter });

      await adapter.prepareForContent();

      expect(adbAdapter.launchActivity).not.toHaveBeenCalled();
      expect(adbAdapter.shell.mock.calls.map(call => call[0]).join('\n')).not.toMatch(/force-stop|am start/);
    });

    it('runs the host-side camera probe over ADB', async () => {
      const adbAdapter = adb('3\n');
      const { adapter } = makeAdapter(screenUp, { adbAdapter });

      const result = await adapter.prepareForContent();

      expect(adbAdapter.connect).toHaveBeenCalledTimes(1);
      expect(adbAdapter.shell).toHaveBeenCalledWith('ls /dev/camera/video* /dev/video* 2>/dev/null | wc -l');
      expect(result).toMatchObject({ ok: true, cameraAvailable: true, cameraSkipped: false });
    });

    it('reports a missing camera after three probes', async () => {
      const adbAdapter = adb('0\n');
      const { adapter, sleep } = makeAdapter(screenUp, { adbAdapter });

      const result = await adapter.prepareForContent();

      expect(adbAdapter.shell).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls.map(call => call[0])).toEqual([2000, 2000]);
      expect(result).toMatchObject({ ok: true, cameraAvailable: false, cameraSkipped: false });
    });

    it('skips the camera probe when asked, and says it did not look', async () => {
      const adbAdapter = adb();
      const { adapter } = makeAdapter(screenUp, { adbAdapter });
      const result = await adapter.prepareForContent({ skipCameraCheck: true });
      expect(adbAdapter.shell).not.toHaveBeenCalled();
      expect(result).toMatchObject({ cameraAvailable: null, cameraSkipped: true });
    });

    it('assumes the camera is there when no ADB probe is configured', async () => {
      const { adapter } = makeAdapter(screenUp);
      await expect(adapter.prepareForContent()).resolves.toMatchObject({
        ok: true, cameraAvailable: true, cameraSkipped: false,
      });
    });

    it('turns a thrown error into a failed result', async () => {
      const { adapter, rest } = makeAdapter();
      rest.post.mockRejectedValue(new Error('boom'));
      await expect(adapter.prepareForContent()).resolves.toEqual({ ok: false, error: 'boom' });
      expect(adapter.getMetrics().errors).toBe(1);
    });
  });

  describe('reboot', () => {
    it('asks the app to reboot the device', async () => {
      const { adapter, rest } = makeAdapter({ 'POST /device/reboot': ok({ rebooting: true }) });
      const result = await adapter.reboot();
      expect(routes(rest)).toEqual(['POST /device/reboot']);
      expect(result.ok).toBe(true);
      expect(result.hint).toMatch(/reboot/i);
    });

    it('falls back to ADB when the app cannot reboot the device', async () => {
      const adbAdapter = { reboot: vi.fn(async () => ({ ok: true })) };
      const { adapter } = makeAdapter({
        'POST /device/reboot': { ok: false, code: 'UNSUPPORTED', error: 'HTTP 501: unsupported - device owner required' },
      }, { adbAdapter });

      const result = await adapter.reboot();

      expect(adbAdapter.reboot).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
    });

    it('reports the refusal when there is no ADB fallback', async () => {
      const { adapter } = makeAdapter({
        'POST /device/reboot': { ok: false, code: 'UNSUPPORTED', error: 'HTTP 501: unsupported - device owner required' },
      });
      await expect(adapter.reboot()).resolves.toEqual({
        ok: false, error: 'HTTP 501: unsupported - device owner required',
      });
    });
  });

  describe('healAudioBridge', () => {
    it('reports no mic bridge on a device without the capability', async () => {
      const { adapter, rest } = makeAdapter({ 'GET /capabilities': ok({ capabilities: ['webview-host'] }) });
      await expect(adapter.healAudioBridge()).resolves.toEqual({ ok: true, companions: [], reason: 'no-mic-bridge' });
      expect(routes(rest)).toEqual(['GET /capabilities']);
    });

    it('leaves a free mic alone unless forced', async () => {
      const table = {
        'GET /capabilities': ok({ capabilities: ['mic-bridge'] }),
        'GET /mic/status': ok({ heldByOther: false }),
      };
      const idle = makeAdapter(table);
      await expect(idle.adapter.healAudioBridge()).resolves.toMatchObject({ ok: true, micRestarted: false });
      expect(routes(idle.rest)).not.toContain('POST /mic/restart');

      const forced = makeAdapter(table);
      await expect(forced.adapter.healAudioBridge({ force: true })).resolves.toMatchObject({ ok: true, micRestarted: true });
      expect(routes(forced.rest)).toContain('POST /mic/restart');
    });

    it('fails when the restart is refused', async () => {
      const { adapter } = makeAdapter({
        'GET /capabilities': ok({ capabilities: ['mic-bridge'] }),
        'GET /mic/status': ok({ heldByOther: true }),
        'POST /mic/restart': fail('HTTP_ERROR', 'HTTP 500: internal'),
      });
      await expect(adapter.healAudioBridge()).resolves.toMatchObject({
        ok: false, micRestarted: false, error: 'HTTP 500: internal',
      });
    });
  });

  it('getMetrics counts loads, prepares and errors', async () => {
    const { adapter } = makeAdapter({ 'POST /screen': ok({ screenOn: true }) });
    await adapter.load('/piano');
    await adapter.prepareForContent({ profile: 'broadcast' });

    expect(adapter.getMetrics()).toMatchObject({
      provider: 'daylight-android',
      host: 'kiosk.test',
      loads: 1,
      prepares: 1,
      errors: 0,
    });
    expect(typeof adapter.getMetrics().uptime).toBe('number');
    expect(adapter.getMetrics().lastRequestAt).toBeTruthy();
  });
});
