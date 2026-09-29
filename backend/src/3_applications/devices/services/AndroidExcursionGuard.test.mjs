// backend/src/3_applications/devices/services/AndroidExcursionGuard.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { AndroidExcursionGuard } from './AndroidExcursionGuard.mjs';

const KIOSK = 'de.ozerov.fully';
const SETTINGS = 'com.android.tv.settings';
const PAIRING = { package: SETTINGS, activity: '.accessories.AddAccessoryActivity' };
const POLICIES = { [SETTINGS]: { allow: ['.accessories.'], maxMs: 60_000 } };

/** A scheduler whose `every` task is driven by hand, one tick per `tick()`. */
function manualScheduler() {
  const tasks = new Set();
  return {
    every(_ms, task) { tasks.add(task); return () => tasks.delete(task); },
    after() { return () => {}; },
    async tick() { for (const task of [...tasks]) await task(); },
    get running() { return tasks.size; },
  };
}

function setup({ screens = [], policies = POLICIES } = {}) {
  let clock = 0;
  const queue = [...screens];
  const probe = {
    foreground: vi.fn(async () => (queue.length > 1 ? queue.shift() : queue[0] ?? null)),
    returnToKiosk: vi.fn(async () => ({ ok: true })),
  };
  const scheduler = manualScheduler();
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const guard = new AndroidExcursionGuard({
    probeFor: (deviceId) => (deviceId === 'livingroom-tv' ? probe : null),
    policies, kioskPackage: KIOSK, scheduler, clock: () => clock, logger,
  });
  return { guard, probe, scheduler, logger, advance: (ms) => { clock += ms; } };
}

const screen = (pkg, activity) => ({ package: pkg, activity });

describe('AndroidExcursionGuard', () => {
  it('does not guard a package that has no policy', () => {
    const { guard, scheduler } = setup();
    const result = guard.start({ deviceId: 'livingroom-tv', package: 'us.zoom.videomeetings', activity: '.Main' });
    expect(result).toEqual({ guarded: false, reason: 'no-policy' });
    expect(scheduler.running).toBe(0);
  });

  it('does not guard a device it cannot probe', () => {
    const { guard } = setup();
    expect(guard.start({ deviceId: 'office-tv', ...PAIRING })).toEqual({ guarded: false, reason: 'no-probe' });
  });

  it('leaves an allowed screen alone and stops once the kiosk is back in front', async () => {
    const { guard, probe, scheduler } = setup({
      screens: [screen(SETTINGS, '.accessories.AddAccessoryActivity'), screen(SETTINGS, '.accessories.BluetoothPairingDialog'), screen(KIOSK, '.LauncherReplacement')],
    });
    expect(guard.start({ deviceId: 'livingroom-tv', ...PAIRING })).toEqual({ guarded: true });
    await scheduler.tick();
    await scheduler.tick();
    expect(probe.returnToKiosk).not.toHaveBeenCalled();
    await scheduler.tick();
    expect(scheduler.running).toBe(0);
    expect(probe.returnToKiosk).not.toHaveBeenCalled();
  });

  it('pulls the kiosk back when the excursion wanders to a screen outside the policy', async () => {
    const { guard, probe, scheduler, logger } = setup({
      screens: [screen(SETTINGS, '.accessories.AddAccessoryActivity'), screen(SETTINGS, '.MainSettings')],
    });
    guard.start({ deviceId: 'livingroom-tv', ...PAIRING });
    await scheduler.tick();
    await scheduler.tick();
    expect(probe.returnToKiosk).toHaveBeenCalledTimes(1);
    expect(scheduler.running).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith('device.excursion.tripped', expect.objectContaining({
      deviceId: 'livingroom-tv', foreground: `${SETTINGS}/.MainSettings`,
    }));
  });

  it('treats a different app in front as wandering, not as the excursion ending', async () => {
    const { guard, probe, scheduler } = setup({
      screens: [screen(SETTINGS, '.accessories.AddAccessoryActivity'), screen('com.example.other', '.Main')],
    });
    guard.start({ deviceId: 'livingroom-tv', ...PAIRING });
    await scheduler.tick();
    await scheduler.tick();
    expect(probe.returnToKiosk).toHaveBeenCalledTimes(1);
  });

  it('accepts the fully-qualified activity spelling dumpsys sometimes prints', async () => {
    const { guard, probe, scheduler } = setup({
      screens: [screen(SETTINGS, `${SETTINGS}.accessories.AddAccessoryActivity`)],
    });
    guard.start({ deviceId: 'livingroom-tv', ...PAIRING });
    await scheduler.tick();
    expect(probe.returnToKiosk).not.toHaveBeenCalled();
    expect(scheduler.running).toBe(1);
  });

  it('waits out the launch while the kiosk is still in front, then gives up if the excursion never starts', async () => {
    const { guard, probe, scheduler, advance, logger } = setup({ screens: [screen(KIOSK, '.LauncherReplacement')] });
    guard.start({ deviceId: 'livingroom-tv', ...PAIRING });
    await scheduler.tick();
    expect(scheduler.running).toBe(1);
    advance(10_001);
    await scheduler.tick();
    expect(scheduler.running).toBe(0);
    expect(probe.returnToKiosk).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('device.excursion.ended', expect.objectContaining({ reason: 'never-left' }));
  });

  it('ends the excursion at the policy cap by returning to the kiosk', async () => {
    const { guard, probe, scheduler, advance, logger } = setup({ screens: [screen(SETTINGS, '.accessories.AddAccessoryActivity')] });
    guard.start({ deviceId: 'livingroom-tv', ...PAIRING });
    await scheduler.tick();
    advance(60_001);
    await scheduler.tick();
    expect(probe.returnToKiosk).toHaveBeenCalledTimes(1);
    expect(scheduler.running).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith('device.excursion.tripped', expect.objectContaining({ reason: 'max-duration' }));
  });

  it('stops after repeated probe failures instead of polling a dead link forever', async () => {
    const { guard, probe, scheduler, logger } = setup();
    probe.foreground.mockResolvedValue(null);
    guard.start({ deviceId: 'livingroom-tv', ...PAIRING });
    for (let i = 0; i < 5; i++) await scheduler.tick();
    expect(scheduler.running).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith('device.excursion.ended', expect.objectContaining({ reason: 'probe-failed' }));
  });

  it('replaces a running guard on the same device rather than stacking a second poller', () => {
    const { guard, scheduler } = setup({ screens: [screen(SETTINGS, '.accessories.AddAccessoryActivity')] });
    guard.start({ deviceId: 'livingroom-tv', ...PAIRING });
    guard.start({ deviceId: 'livingroom-tv', ...PAIRING });
    expect(scheduler.running).toBe(1);
  });
});
