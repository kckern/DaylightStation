import { describe, it, expect, vi } from 'vitest';
import { DaylightAndroidForegroundProbe } from './DaylightAndroidForegroundProbe.mjs';
import { AndroidExcursionGuard } from '#apps/devices/services/AndroidExcursionGuard.mjs';

const ok = (data = {}) => ({ ok: true, data: { ok: true, ...data } });
const KIOSK = 'de.ozerov.fully';

function build(status, { post = vi.fn(async () => ok({ kioskInForeground: true })) } = {}) {
  const get = vi.fn(async () => (typeof status === 'function' ? status() : status));
  const probe = new DaylightAndroidForegroundProbe({
    restClient: { get, post, delete: vi.fn() }, kioskPackage: KIOSK, logger: { debug: vi.fn() },
  });
  return { probe, get, post };
}

describe('DaylightAndroidForegroundProbe', () => {
  it('requires a rest client and the package name the guard knows the kiosk by', () => {
    expect(() => new DaylightAndroidForegroundProbe({ kioskPackage: KIOSK })).toThrow(/restClient/);
    expect(() => new DaylightAndroidForegroundProbe({ restClient: { get() {}, post() {} } })).toThrow(/kioskPackage/);
  });

  it('reports the kiosk under the guard\'s kiosk package when the app says it is in front', async () => {
    const { probe, get } = build(ok({ foreground: 'net.example.kioskapp', kioskInForeground: true }));
    await expect(probe.foreground()).resolves.toEqual({ package: KIOSK, activity: '' });
    expect(get).toHaveBeenCalledWith('/lockdown');
  });

  it('reports the package and activity in front when the kiosk is not', async () => {
    const { probe } = build(ok({
      foreground: 'com.android.tv.settings',
      foregroundActivity: 'com.android.tv.settings.accessories.AddAccessoryActivity',
      kioskInForeground: false,
    }));
    await expect(probe.foreground()).resolves.toEqual({
      package: 'com.android.tv.settings',
      activity: 'com.android.tv.settings.accessories.AddAccessoryActivity',
    });
  });

  it('still recognises the kiosk when it reports its own activity', async () => {
    const { probe } = build(ok({ foreground: 'net.example.kioskapp', foregroundActivity: 'net.example.kioskapp.Main', kioskInForeground: true }));
    await expect(probe.foreground()).resolves.toEqual({ package: KIOSK, activity: 'net.example.kioskapp.Main' });
  });

  it.each([
    ['the device does not answer', { ok: false, code: 'UNREACHABLE', error: 'connect ECONNREFUSED' }],
    ['the status carries no foreground', ok({ kioskInForeground: false })],
    // The ADB probe answers null when it cannot read the resumed activity; so does this one.
    ['the app does not know the activity in front', ok({ foreground: 'com.android.tv.settings', foregroundActivity: null, kioskInForeground: false })],
  ])('returns null, not a guess, when %s', async (_label, status) => {
    const { probe } = build(status);
    await expect(probe.foreground()).resolves.toBeNull();
  });

  it('returns to the kiosk through the app', async () => {
    const { probe, post } = build(ok());
    await expect(probe.returnToKiosk()).resolves.toMatchObject({ ok: true });
    expect(post).toHaveBeenCalledWith('/kiosk/foreground');
  });

  it('passes a failed return through so the guard can log it', async () => {
    const failure = { ok: false, code: 'COMMAND_REJECTED', error: 'Command was rejected' };
    const { probe } = build(ok(), { post: vi.fn(async () => failure) });
    await expect(probe.returnToKiosk()).resolves.toEqual(failure);
  });

  describe('behind AndroidExcursionGuard', () => {
    function guarded(statuses) {
      let tick;
      const scheduler = { every: (_ms, fn) => { tick = fn; return () => { tick = null; }; } };
      let now = 0;
      const { probe, post } = build(() => statuses.shift());
      const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
      const guard = new AndroidExcursionGuard({
        probeFor: () => probe,
        policies: { 'com.android.tv.settings': { allow: ['.accessories.'], maxMs: 60_000 } },
        kioskPackage: KIOSK, scheduler, clock: () => now, logger,
      });
      return { guard, post, logger, step: async (ms = 1500) => { now += ms; await tick?.(); }, running: () => tick != null };
    }

    it('keeps watching while the kiosk is still in front just after the launch', async () => {
      const g = guarded([
        ok({ foreground: 'net.example.kioskapp', kioskInForeground: true }),
        ok({ foreground: 'org.example.game', foregroundActivity: 'org.example.game.Main', kioskInForeground: false }),
      ]);
      expect(g.guard.start({ deviceId: 'tv', package: 'com.android.tv.settings' })).toEqual({ guarded: true });
      await g.step();
      expect(g.running()).toBe(true);
      expect(g.post).not.toHaveBeenCalled();
    });

    it('leaves an allowed screen alone and sends the device home from any other screen of the same package', async () => {
      const g = guarded([
        ok({ foreground: 'com.android.tv.settings', foregroundActivity: 'com.android.tv.settings.accessories.AddAccessoryActivity', kioskInForeground: false }),
        ok({ foreground: 'com.android.tv.settings', foregroundActivity: '.accessories.BluetoothPairingDialog', kioskInForeground: false }),
        ok({ foreground: 'com.android.tv.settings', foregroundActivity: 'com.android.tv.settings.MainSettings', kioskInForeground: false }),
      ]);
      g.guard.start({ deviceId: 'tv', package: 'com.android.tv.settings' });
      await g.step();
      await g.step();
      expect(g.post).not.toHaveBeenCalled();
      expect(g.running()).toBe(true);

      await g.step();
      expect(g.post).toHaveBeenCalledWith('/kiosk/foreground');
      expect(g.logger.warn).toHaveBeenCalledWith('device.excursion.tripped', expect.objectContaining({
        reason: 'outside-policy', foreground: 'com.android.tv.settings/com.android.tv.settings.MainSettings',
      }));
    });

    it('counts an unknown activity as a failed probe, and does not send the device home for it', async () => {
      const g = guarded([ok({ foreground: 'com.android.tv.settings', foregroundActivity: null, kioskInForeground: false })]);
      g.guard.start({ deviceId: 'tv', package: 'com.android.tv.settings' });
      await g.step();
      expect(g.post).not.toHaveBeenCalled();
      expect(g.running()).toBe(true);
    });

    it('sends the device home when the excursion is somewhere its policy does not allow', async () => {
      const g = guarded([ok({ foreground: 'org.example.game', foregroundActivity: 'org.example.game.Main', kioskInForeground: false })]);
      g.guard.start({ deviceId: 'tv', package: 'com.android.tv.settings' });
      await g.step();
      expect(g.post).toHaveBeenCalledWith('/kiosk/foreground');
      expect(g.logger.warn).toHaveBeenCalledWith('device.excursion.tripped', expect.objectContaining({ reason: 'outside-policy' }));
      expect(g.running()).toBe(false);
    });
  });
});
