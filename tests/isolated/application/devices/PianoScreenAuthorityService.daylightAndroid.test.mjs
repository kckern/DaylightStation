// The piano screen authority reaches the tablet through deviceService → Device →
// its content adapter, so switching the tablet's `content_control.provider` to
// `daylight-android` is the whole switch for it. These run the real service over
// the real Device and the real DaylightAndroidContentAdapter, with only the
// control API's answers faked, to prove the off, on and verify paths survive it.
// ops:docs/superpowers/plans/2026-11-17-daylight-android-phases-4-6-cutover.md
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PianoScreenAuthorityService } from '../../../../__app_modules/learning/piano/server/application/services/PianoScreenAuthorityService.mjs';
import { Device } from '#apps/devices/services/Device.mjs';
import { DaylightAndroidContentAdapter } from '#adapters/devices/DaylightAndroidContentAdapter.mjs';

const POLL_MS = 3000;
const OFF_DEBOUNCE_MS = 15000;
const noLog = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** A control API whose display follows POST /screen, unless `stuck` holds it. */
function makeTablet({ screenOn = true, stuck = null } = {}) {
  const state = { screenOn, calls: [] };
  const rest = {
    get: vi.fn(async (route) => {
      state.calls.push(`GET ${route}`);
      if (route === '/kiosk/status') return { ok: true, data: { ok: true, ready: true, screenOn: state.screenOn } };
      if (route === '/status') return { ok: true, data: { ok: true, appVersion: '0.3-kiosk' } };
      return { ok: true, data: { ok: true } };
    }),
    post: vi.fn(async (route, body) => {
      state.calls.push(`POST ${route}`);
      if (route === '/screen') {
        if (stuck === null) state.screenOn = body.on;
        return { ok: true, data: { ok: true, screenOn: state.screenOn } };
      }
      return { ok: true, data: { ok: true, loaded: true } };
    }),
    delete: vi.fn(),
  };
  const adapter = new DaylightAndroidContentAdapter({ host: 'tablet.test', port: 8780, token: 'tok' }, { restClient: rest, logger: noLog() });
  const device = new Device({ id: 'yellow-room-tablet', type: 'android-tablet' }, { contentControl: adapter }, { logger: noLog() });
  return { state, device };
}

function makeService(device, power) {
  const gateway = { getState: vi.fn(async () => ({ state: power() })), callService: vi.fn(async () => ({ ok: true })) };
  const svc = new PianoScreenAuthorityService({
    haGateway: gateway,
    sendPush: ({ haNotifyService, ...push }) => gateway.callService('notify', haNotifyService, push),
    deviceService: { get: vi.fn().mockReturnValue(device) },
    logger: noLog(),
    clock: { now: () => Date.now() },
    deviceId: 'yellow-room-tablet',
    pianoPowerEntity: 'binary_sensor.piano_power',
    pollIntervalMs: POLL_MS,
    offDebounceMs: OFF_DEBOUNCE_MS,
    reconcileIntervalMs: 45000,
    maxRetries: 2,
    notifyService: 'mobile_app_test',
    scheduler: {
      every: (ms, task) => { const t = setInterval(task, ms); return () => clearInterval(t); },
      wait: () => Promise.resolve(),
    },
  });
  return { svc, gateway };
}

describe('PianoScreenAuthorityService on the DaylightStation Android app', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('piano off: POST /screen {on:false}, verified from /kiosk/status', async () => {
    let power = 'on';
    const tablet = makeTablet({ screenOn: true });
    const { svc } = makeService(tablet.device, () => power);
    svc.start();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    power = 'off';
    await vi.advanceTimersByTimeAsync(OFF_DEBOUNCE_MS + POLL_MS * 2);
    svc.stop();
    expect(tablet.state.screenOn).toBe(false);
    expect(tablet.state.calls).toContain('POST /screen');
    expect(tablet.state.calls).toContain('GET /kiosk/status');
  });

  it('piano on after off: the wake edge turns the display back on', async () => {
    let power = 'off';
    const tablet = makeTablet({ screenOn: true });
    const { svc } = makeService(tablet.device, () => power);
    svc.start();
    await vi.advanceTimersByTimeAsync(OFF_DEBOUNCE_MS + POLL_MS * 2);
    expect(tablet.state.screenOn).toBe(false);
    power = 'on';
    await vi.advanceTimersByTimeAsync(POLL_MS);
    svc.stop();
    expect(tablet.state.screenOn).toBe(true);
  });

  it('a display that will not light: retries, revives the page with load-start, then notifies', async () => {
    let power = 'off';
    const tablet = makeTablet({ screenOn: false, stuck: 'off' });
    const { svc, gateway } = makeService(tablet.device, () => power);
    svc.start();
    await vi.advanceTimersByTimeAsync(OFF_DEBOUNCE_MS + POLL_MS * 2);
    power = 'on';
    await vi.advanceTimersByTimeAsync(POLL_MS);
    svc.stop();
    expect(tablet.state.calls).toContain('POST /kiosk/load-start');
    expect(gateway.callService).toHaveBeenCalledWith('notify', 'mobile_app_test', expect.objectContaining({ title: expect.any(String) }));
  });
});
