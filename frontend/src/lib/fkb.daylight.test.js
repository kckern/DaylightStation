import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The module keeps one-time bind state, so each test loads a fresh copy and
// reads the log through a mocked logger.
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() };
vi.mock('./logging/Logger.js', () => ({
  default: () => ({ child: () => log }),
}));

const PKG = 'com.retroarch.aarch64';
const ACT = 'com.retroarch.browser.retroactivity.RetroActivityFuture';

/** The page bridge the Android kiosk app injects, per the control API contract. */
function mockDaylight(overrides = {}) {
  const daylight = {
    version: '1.4.0',
    deviceId: 'piano-tablet',
    capabilities: vi.fn(() => '["webview-host","screen-power","app-launcher"]'),
    launch: vi.fn(() => true),
    screen: vi.fn(() => true),
    restartApp: vi.fn(),
    reboot: vi.fn(() => true),
    setBackMode: vi.fn(),
    volume: vi.fn(() => '{"level":40,"index":7,"maxIndex":18}'),
    ...overrides,
  };
  global.daylight = daylight;
  return daylight;
}

function mockFully(overrides = {}) {
  const fully = {
    startApplication: vi.fn(),
    startIntent: vi.fn(),
    turnScreenOff: vi.fn(),
    turnScreenOn: vi.fn(),
    bind: vi.fn(),
    ...overrides,
  };
  global.fully = fully;
  return fully;
}

const launched = (daylight, call = 0) => JSON.parse(daylight.launch.mock.calls[call][0]);
const warned = event => log.warn.mock.calls.filter(([name]) => name === event).map(([, data]) => data);

let fkb;
let listeners;

beforeEach(async () => {
  vi.resetModules();
  Object.values(log).forEach(fn => fn.mockClear());
  // Track listeners this test adds to window so they can be removed again.
  listeners = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, handler, options) => {
    listeners.push([type, handler, options]);
    return add(type, handler, options);
  });
  fkb = await import('./fkb.js');
});

afterEach(() => {
  for (const [type, handler, options] of listeners) window.removeEventListener(type, handler, options);
  delete global.daylight;
  delete global.fully;
  delete global.FullyKiosk;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('fkb on the Fully bridge (unchanged)', () => {
  it('makes the same Fully calls as before', () => {
    const fully = mockFully();

    expect(fkb.isFKBAvailable()).toBe(true);
    expect(fkb.launchApp('org.example.app')).toBe(true);
    expect(fkb.startApplication('com.android.settings', 'android.settings.BLUETOOTH_SETTINGS')).toBe(true);
    expect(fkb.launchAndroidTarget({ action: 'android.settings.BLUETOOTH_SETTINGS' })).toBe(true);
    expect(fkb.launchAndroidTarget({ package: 'org.example.app' })).toBe(true);
    expect(fkb.launchIntent(PKG, ACT, { ROM: '/a b.gb' })).toBe(true);
    expect(fkb.screenOff()).toBe(true);
    expect(fkb.screenOn()).toBe(true);

    expect(fully.startApplication.mock.calls).toEqual([
      ['org.example.app'],
      ['com.android.settings', 'android.settings.BLUETOOTH_SETTINGS'],
      ['org.example.app'],
    ]);
    expect(fully.startIntent.mock.calls).toEqual([
      ['intent:#Intent;action=android.settings.BLUETOOTH_SETTINGS;end'],
      [`intent:#Intent;component=${PKG}/${ACT};S.ROM=%2Fa%20b.gb;end`],
    ]);
    expect(fully.turnScreenOff).toHaveBeenCalledTimes(1);
    expect(fully.turnScreenOn).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('onResume binds once through fully.bind and runs the latest callback', () => {
    const fully = mockFully();
    const first = vi.fn();
    const second = vi.fn();

    fkb.onResume(first);
    fkb.onResume(second);

    expect(fully.bind).toHaveBeenCalledTimes(1);
    expect(fully.bind).toHaveBeenCalledWith('onResume', expect.any(Function));
    fully.bind.mock.calls[0][1]();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(listeners.filter(([type]) => type.startsWith('daylight:'))).toEqual([]);
  });

  it('bindBackButton binds onBackButton to history.back', () => {
    const fully = mockFully();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});

    fkb.bindBackButton();
    fkb.bindBackButton();

    expect(fully.bind).toHaveBeenCalledTimes(1);
    expect(fully.bind).toHaveBeenCalledWith('onBackButton', expect.any(Function));
    fully.bind.mock.calls[0][1]();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('scheduleDismissAfterLaunch dismisses on the timer and again on resume', () => {
    vi.useFakeTimers();
    const fully = mockFully();
    const dismiss = vi.fn();

    fkb.scheduleDismissAfterLaunch(dismiss, 1500);
    vi.advanceTimersByTime(1500);
    expect(dismiss).toHaveBeenCalledTimes(1);
    fully.bind.mock.calls[0][1]();
    expect(dismiss).toHaveBeenCalledTimes(2);
  });

  it('names the Fully bridge when it lacks the method a call needs', () => {
    mockFully({ startIntent: undefined, turnScreenOff: undefined });

    expect(fkb.launchIntent(PKG, ACT)).toBe(false);
    expect(fkb.screenOff()).toBe(false);

    expect(warned('fkb.intent.unavailable')).toEqual([{ packageName: PKG, bridge: 'present', bridgeKind: 'fully' }]);
    expect(warned('fkb.screenOff.unavailable')).toEqual([{ bridge: 'present', bridgeKind: 'fully' }]);
  });
});

describe('fkb on the daylight bridge', () => {
  it('is available', () => {
    mockDaylight();
    expect(fkb.isFKBAvailable()).toBe(true);
  });

  it('launchApp launches the package', () => {
    const daylight = mockDaylight();
    expect(fkb.launchApp('org.example.app')).toBe(true);
    expect(launched(daylight)).toEqual({ package: 'org.example.app' });
  });

  it('startApplication sends the second argument as the activity', () => {
    const daylight = mockDaylight();

    expect(fkb.startApplication('com.android.settings', 'com.android.settings.Settings$BluetoothSettingsActivity')).toBe(true);
    expect(fkb.startApplication('com.android.settings')).toBe(true);

    expect(launched(daylight, 0)).toEqual({
      package: 'com.android.settings',
      activity: 'com.android.settings.Settings$BluetoothSettingsActivity',
    });
    expect(launched(daylight, 1)).toEqual({ package: 'com.android.settings' });
  });

  it('launchAndroidTarget sends an action or a component as an intent URI, and a bare package as a package', () => {
    const daylight = mockDaylight();

    expect(fkb.launchAndroidTarget({ action: 'android.settings.BLUETOOTH_SETTINGS' })).toBe(true);
    expect(fkb.launchAndroidTarget({ package: 'com.android.settings', activity: '.Main' })).toBe(true);
    expect(fkb.launchAndroidTarget({ package: 'org.example.app' })).toBe(true);
    expect(fkb.launchAndroidTarget({})).toBe(false);

    expect(launched(daylight, 0)).toEqual({ intent: 'intent:#Intent;action=android.settings.BLUETOOTH_SETTINGS;end' });
    expect(launched(daylight, 1)).toEqual({ intent: 'intent:#Intent;component=com.android.settings/.Main;end' });
    expect(launched(daylight, 2)).toEqual({ package: 'org.example.app' });
    expect(daylight.launch).toHaveBeenCalledTimes(3);
  });

  it('launchIntent sends the same encoded intent URI it sends to Fully', () => {
    const daylight = mockDaylight();

    expect(fkb.launchIntent(PKG, ACT, { ROM: '/a b;c.gb' })).toBe(true);

    expect(launched(daylight)).toEqual({
      intent: `intent:#Intent;component=${PKG}/${ACT};S.ROM=%2Fa%20b%3Bc.gb;end`,
    });
    expect(fkb.launchIntent(PKG, ACT, { 'BAD;KEY': 'x' })).toBe(false);
    expect(daylight.launch).toHaveBeenCalledTimes(1);
  });

  it('reports a launch the bridge did not accept', () => {
    mockDaylight({ launch: vi.fn(() => false) });

    expect(fkb.launchApp('org.example.app')).toBe(false);
    expect(fkb.startApplication('org.example.app')).toBe(false);
    expect(fkb.launchIntent(PKG, ACT)).toBe(false);
    expect(fkb.launchAndroidTarget({ action: 'x' })).toBe(false);
    expect(fkb.launchAndroidTarget({ package: 'org.example.app' })).toBe(false);

    expect(warned('fkb.launch.rejected')).toEqual([{ packageName: 'org.example.app', bridge: 'present', bridgeKind: 'daylight' }]);
    expect(warned('fkb.intent.rejected')).toHaveLength(1);
  });

  it('screenOff and screenOn call daylight.screen with the wanted state', () => {
    const daylight = mockDaylight();

    expect(fkb.screenOff()).toBe(true);
    expect(fkb.screenOn()).toBe(true);

    expect(daylight.screen.mock.calls).toEqual([[false], [true]]);
  });

  it('screenOff reports a refusal and contains a throw', () => {
    mockDaylight({ screen: vi.fn(() => false) });
    expect(fkb.screenOff()).toBe(false);
    expect(fkb.screenOn()).toBe(false);

    mockDaylight({ screen: vi.fn(() => { throw new Error('bridge down'); }) });
    expect(() => fkb.screenOff()).not.toThrow();
    expect(fkb.screenOff()).toBe(false);
  });

  it('a throwing launch is contained and returns false', () => {
    mockDaylight({ launch: vi.fn(() => { throw new Error('bridge down'); }) });
    expect(() => fkb.launchApp('org.example.app')).not.toThrow();
    expect(fkb.launchApp('org.example.app')).toBe(false);
    expect(fkb.launchIntent(PKG, ACT)).toBe(false);
  });

  it('onResume listens for daylight:resume once and runs the latest callback', () => {
    mockDaylight();
    const first = vi.fn();
    const second = vi.fn();

    fkb.onResume(first);
    fkb.onResume(second);

    expect(listeners.filter(([type]) => type === 'daylight:resume')).toHaveLength(1);
    window.dispatchEvent(new CustomEvent('daylight:resume', { detail: { awayMs: 4200, from: 'org.example.app' } }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith('fkb.resume', { awayMs: 4200, from: 'org.example.app' });
  });

  it('scheduleDismissAfterLaunch dismisses on the timer and again on daylight:resume', () => {
    vi.useFakeTimers();
    mockDaylight();
    const dismiss = vi.fn();

    fkb.scheduleDismissAfterLaunch(dismiss, 1500);
    vi.advanceTimersByTime(1500);
    expect(dismiss).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new CustomEvent('daylight:resume', { detail: { awayMs: 10, from: 'x' } }));
    expect(dismiss).toHaveBeenCalledTimes(2);
  });

  it('bindBackButton asks for page back mode and maps daylight:back to history.back', () => {
    const daylight = mockDaylight();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});

    fkb.bindBackButton();
    fkb.bindBackButton();

    expect(daylight.setBackMode.mock.calls).toEqual([['page']]);
    expect(listeners.filter(([type]) => type === 'daylight:back')).toHaveLength(1);
    window.dispatchEvent(new CustomEvent('daylight:back', { detail: {} }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('bindBackButton without setBackMode warns, does not listen, and does not throw', () => {
    mockDaylight({ setBackMode: undefined });
    expect(() => fkb.bindBackButton()).not.toThrow();
    expect(listeners.filter(([type]) => type === 'daylight:back')).toHaveLength(0);
    expect(warned('fkb.bind.unavailable')).toEqual([{ event: 'onBackButton', bridgeKind: 'daylight' }]);
  });

  it('names the daylight bridge when it lacks the method a call needs', () => {
    mockDaylight({ launch: undefined });

    expect(fkb.isFKBAvailable()).toBe(true);
    expect(fkb.launchApp('org.example.app')).toBe(false);
    expect(fkb.startApplication('org.example.app', '.Main')).toBe(false);
    expect(fkb.launchAndroidTarget({ action: 'x' })).toBe(false);
    expect(fkb.launchIntent(PKG, ACT)).toBe(false);
    expect(fkb.screenOff()).toBe(true);

    expect(warned('fkb.launch.unavailable')).toEqual([{ packageName: 'org.example.app', bridge: 'present', bridgeKind: 'daylight' }]);
    expect(warned('fkb.startApplication.unavailable')).toEqual([
      { packageName: 'org.example.app', activityName: '.Main', bridge: 'present', bridgeKind: 'daylight' },
    ]);
    expect(warned('fkb.launchTarget.unavailable')[0]).toMatchObject({ action: 'x', bridge: 'present', bridgeKind: 'daylight' });
    expect(warned('fkb.intent.unavailable')).toEqual([{ packageName: PKG, bridge: 'present', bridgeKind: 'daylight' }]);
  });

  it('does not accept an object named daylight that has no control method', () => {
    global.daylight = { version: '1.4.0', deviceId: 'x' };
    expect(fkb.isFKBAvailable()).toBe(false);
    expect(fkb.screenOff()).toBe(false);
    expect(warned('fkb.screenOff.unavailable')).toEqual([{ bridge: 'absent', bridgeKind: null }]);
  });

  it('survives a daylight object whose property access throws', () => {
    global.daylight = new Proxy({}, { get() { throw new Error('bridge blew up'); } });
    expect(() => fkb.isFKBAvailable()).not.toThrow();
    expect(fkb.screenOff()).toBe(false);
    expect(() => fkb.bindBackButton()).not.toThrow();
  });
});

describe('fkb restartApp and reboot', () => {
  it('unavailable logs keep the bridge field they always had and add bridgeKind', () => {
    // Existing log-store queries match on bridge:'present' / bridge:'absent'.
    global.fully = { turnScreenOn: vi.fn() };
    fkb.launchApp('org.example.app');
    fkb.launchIntent(PKG, ACT);
    fkb.screenOff();
    fkb.bindBackButton();
    fkb.onResume(() => {});
    expect(warned('fkb.launch.unavailable')).toEqual([{ packageName: 'org.example.app', bridge: 'present', bridgeKind: 'fully' }]);
    expect(warned('fkb.intent.unavailable')).toEqual([{ packageName: PKG, bridge: 'present', bridgeKind: 'fully' }]);
    expect(warned('fkb.screenOff.unavailable')).toEqual([{ bridge: 'present', bridgeKind: 'fully' }]);
    expect(warned('fkb.bind.unavailable')).toEqual([
      { event: 'onBackButton', bridgeKind: 'fully' },
      { event: 'onResume', bridgeKind: 'fully' },
    ]);
  });

  it('on Fully calls fully.restartApp and fully.reboot', () => {
    const fully = mockFully({ restartApp: vi.fn(), reboot: vi.fn() });

    expect(fkb.canRestartApp()).toBe(true);
    expect(fkb.restartApp()).toBe(true);
    expect(fkb.reboot()).toBe(true);

    expect(fully.restartApp).toHaveBeenCalledTimes(1);
    expect(fully.reboot).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('an object carrying nothing but restartApp or reboot does not qualify as a Fully bridge', () => {
    global.fully = { reboot: vi.fn(), restartApp: vi.fn() };
    expect(fkb.isFKBAvailable()).toBe(false);
    expect(fkb.canRestartApp()).toBe(false);
    expect(fkb.reboot()).toBe(false);
    expect(fkb.restartApp()).toBe(false);
    expect(global.fully.reboot).not.toHaveBeenCalled();
    expect(warned('fkb.reboot.unavailable')).toEqual([{ bridge: 'absent', bridgeKind: null }]);
  });

  it('works on a Fully bridge that qualifies by a control method and lacks one of the two calls', () => {
    global.fully = { turnScreenOff: vi.fn(), reboot: vi.fn() };
    expect(fkb.reboot()).toBe(true);
    expect(fkb.canRestartApp()).toBe(false);
    expect(fkb.restartApp()).toBe(false);
    expect(warned('fkb.restartApp.unavailable')).toEqual([{ bridge: 'present', bridgeKind: 'fully' }]);
  });

  it('reboots through window.FullyKiosk on a page that has no window.fully', () => {
    const reboot = vi.fn();
    const restartApp = vi.fn();
    global.FullyKiosk = { turnScreenOff: vi.fn(), reboot, restartApp };
    expect(typeof global.fully).toBe('undefined');

    expect(fkb.reboot()).toBe(true);
    expect(fkb.restartApp()).toBe(true);

    expect(reboot).toHaveBeenCalledTimes(1);
    expect(restartApp).toHaveBeenCalledTimes(1);
  });

  it('hands a thrown error to onError, on either bridge, and still returns false', () => {
    const onError = vi.fn();
    mockFully({ reboot: vi.fn(() => { throw new Error('fully down'); }) });
    expect(fkb.reboot({ onError })).toBe(false);
    expect(onError.mock.calls[0][0].message).toBe('fully down');

    delete global.fully;
    mockDaylight({ reboot: vi.fn(() => { throw new Error('daylight down'); }) });
    expect(fkb.reboot({ onError })).toBe(false);
    expect(onError.mock.calls[1][0].message).toBe('daylight down');
  });

  it('on daylight calls daylight.restartApp and daylight.reboot', () => {
    const daylight = mockDaylight();
    const fully = mockFully({ restartApp: vi.fn(), reboot: vi.fn() });

    expect(fkb.canRestartApp()).toBe(true);
    expect(fkb.restartApp()).toBe(true);
    expect(fkb.reboot()).toBe(true);

    expect(daylight.restartApp).toHaveBeenCalledTimes(1);
    expect(daylight.reboot).toHaveBeenCalledTimes(1);
    expect(fully.restartApp).not.toHaveBeenCalled();
    expect(fully.reboot).not.toHaveBeenCalled();
  });

  it('reports a reboot the device cannot do', () => {
    mockDaylight({ reboot: vi.fn(() => false) });
    expect(fkb.reboot()).toBe(false);
    expect(warned('fkb.reboot.rejected')).toEqual([{ bridge: 'present', bridgeKind: 'daylight' }]);
  });

  it('names the bridge that lacks the call', () => {
    mockDaylight({ restartApp: undefined, reboot: undefined });
    expect(fkb.canRestartApp()).toBe(false);
    expect(fkb.restartApp()).toBe(false);
    expect(fkb.reboot()).toBe(false);
    expect(warned('fkb.restartApp.unavailable')).toEqual([{ bridge: 'present', bridgeKind: 'daylight' }]);
    expect(warned('fkb.reboot.unavailable')).toEqual([{ bridge: 'present', bridgeKind: 'daylight' }]);
  });

  it('is unavailable with no bridge, and canRestartApp does not warn', () => {
    expect(fkb.canRestartApp()).toBe(false);
    expect(log.warn).not.toHaveBeenCalled();
    expect(fkb.restartApp()).toBe(false);
    expect(fkb.reboot()).toBe(false);
    expect(warned('fkb.restartApp.unavailable')).toEqual([{ bridge: 'absent', bridgeKind: null }]);
    expect(warned('fkb.reboot.unavailable')).toEqual([{ bridge: 'absent', bridgeKind: null }]);
  });

  it('contains a bridge that throws', () => {
    mockFully({ restartApp: vi.fn(() => { throw new Error('bridge down'); }), reboot: vi.fn(() => { throw new Error('bridge down'); }) });
    expect(() => fkb.restartApp()).not.toThrow();
    expect(fkb.restartApp()).toBe(false);
    expect(fkb.reboot()).toBe(false);
    expect(warned('fkb.reboot.failed')).toEqual([{ bridge: 'present', bridgeKind: 'fully', error: 'bridge down' }]);
  });

  it('the Fully qualifying list is the original one', () => {
    for (const name of ['turnScreenOff', 'turnScreenOn', 'startApplication', 'startIntent', 'bind']) {
      global.fully = { [name]: vi.fn() };
      expect(fkb.isFKBAvailable()).toBe(true);
    }
    for (const name of ['restartApp', 'reboot', 'getDeviceId', 'print']) {
      global.fully = { [name]: vi.fn() };
      expect(fkb.isFKBAvailable()).toBe(false);
    }
  });
});

describe('fkb with no bridge', () => {
  it('every call returns safely and says the bridge is absent', () => {
    expect(fkb.isFKBAvailable()).toBe(false);
    expect(fkb.launchApp('org.example.app')).toBe(false);
    expect(fkb.startApplication('org.example.app', '.Main')).toBe(false);
    expect(fkb.launchAndroidTarget({ action: 'x' })).toBe(false);
    expect(fkb.launchIntent(PKG, ACT)).toBe(false);
    expect(fkb.screenOff()).toBe(false);
    expect(fkb.screenOn()).toBe(false);
    expect(() => fkb.onResume(() => {})).not.toThrow();
    expect(() => fkb.bindBackButton()).not.toThrow();

    expect(warned('fkb.launch.unavailable')).toEqual([{ packageName: 'org.example.app', bridge: 'absent', bridgeKind: null }]);
    expect(warned('fkb.startApplication.unavailable')).toEqual([
      { packageName: 'org.example.app', activityName: '.Main', bridge: 'absent', bridgeKind: null },
    ]);
    expect(warned('fkb.launchTarget.unavailable')[0]).toMatchObject({ bridge: 'absent', bridgeKind: null });
    expect(warned('fkb.intent.unavailable')).toEqual([{ packageName: PKG, bridge: 'absent', bridgeKind: null }]);
    expect(warned('fkb.screenOff.unavailable')).toEqual([{ bridge: 'absent', bridgeKind: null }]);
    expect(warned('fkb.screenOn.unavailable')).toEqual([{ bridge: 'absent', bridgeKind: null }]);
    // Event binding logs nothing off-kiosk, as before: an ordinary browser has
    // no bridge and startup must not warn about that on every page load.
    expect(warned('fkb.bind.unavailable')).toEqual([]);
    expect(listeners.filter(([type]) => type.startsWith('daylight:'))).toEqual([]);
  });
});

describe('fkb with both bridges present', () => {
  it('daylight wins for calls', () => {
    const daylight = mockDaylight();
    const fully = mockFully();

    expect(fkb.launchApp('org.example.app')).toBe(true);
    expect(fkb.launchIntent(PKG, ACT)).toBe(true);
    expect(fkb.screenOff()).toBe(true);

    expect(daylight.launch).toHaveBeenCalledTimes(2);
    expect(daylight.screen).toHaveBeenCalledWith(false);
    expect(fully.startApplication).not.toHaveBeenCalled();
    expect(fully.startIntent).not.toHaveBeenCalled();
    expect(fully.turnScreenOff).not.toHaveBeenCalled();
  });

  it('daylight wins for events', () => {
    const daylight = mockDaylight();
    const fully = mockFully();
    const resumed = vi.fn();
    vi.spyOn(window.history, 'back').mockImplementation(() => {});

    fkb.onResume(resumed);
    fkb.bindBackButton();

    expect(fully.bind).not.toHaveBeenCalled();
    expect(daylight.setBackMode).toHaveBeenCalledWith('page');
    window.dispatchEvent(new CustomEvent('daylight:resume', { detail: { awayMs: 1, from: 'x' } }));
    expect(resumed).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to Fully for a method daylight lacks', () => {
    mockDaylight({ launch: undefined });
    const fully = mockFully();

    expect(fkb.launchApp('org.example.app')).toBe(false);
    expect(fully.startApplication).not.toHaveBeenCalled();
    expect(warned('fkb.launch.unavailable')).toEqual([{ packageName: 'org.example.app', bridge: 'present', bridgeKind: 'daylight' }]);
  });
});
