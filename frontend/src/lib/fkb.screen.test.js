import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screenOff, screenOn, bindBackButton, onResume, launchApp } from './fkb.js';

/**
 * A NAME ON `window` IS NOT A CAPABILITY.
 *
 * Probed on the school Portal: there is no `window.fully` at all, and the
 * `window.FullyKiosk` that IS there is a blob/print helper (five methods:
 * getBase64FromBlobData, getFullyVersion, getFullyVersionCode, grab, print) —
 * not the kiosk-control object. Accepting it by name made availability lie,
 * and `bindBackButton()` — which runs at app STARTUP — then called `.bind()`
 * on an object that has none. The throw landed before any error listener the
 * page installs, so React never mounted: a black panel and a silent log, for
 * eighty minutes.
 *
 * These pin CAPABILITY: a candidate must carry a control method to qualify,
 * and a missing method must be a no-op, never a throw.
 */
describe('fkb bridge: capability, not presence', () => {
  afterEach(() => {
    delete global.fully;
    delete global.FullyKiosk;
    vi.restoreAllMocks();
  });

  // THE PORTAL'S ACTUAL WINDOW, probed on-device: a `FullyKiosk` that is a
  // blob/print helper, not the control interface. Matching it on name alone is
  // what made availability lie and what blanked the panel.
  const PORTAL_HELPER = {
    getBase64FromBlobData() {}, getFullyVersion() {}, getFullyVersionCode() {},
    grab() {}, print() {},
  };

  it('does not mistake the Portal helper object for the control interface', async () => {
    global.FullyKiosk = PORTAL_HELPER;
    const { isFKBAvailable } = await import('./fkb.js');
    expect(isFKBAvailable()).toBe(false);
    expect(screenOff()).toBe(false);
    expect(() => bindBackButton()).not.toThrow();
  });

  it('bindBackButton does not throw when the bridge has no bind (native-only device)', () => {
    global.FullyKiosk = { turnScreenOff: vi.fn(), startApplication: vi.fn() };
    expect(() => bindBackButton()).not.toThrow();
  });

  it('onResume does not throw when the bridge has no bind', () => {
    global.FullyKiosk = { turnScreenOff: vi.fn() };
    expect(() => onResume(() => {})).not.toThrow();
  });

  it('still binds through the alias when bind IS available', () => {
    const bind = vi.fn();
    global.fully = { bind };
    bindBackButton();
    expect(bind).toHaveBeenCalledWith('onBackButton', expect.any(Function));
  });

  it('a method-less bridge degrades every call to false rather than throwing', () => {
    global.FullyKiosk = {};
    expect(() => screenOff()).not.toThrow();
    expect(screenOff()).toBe(false);
    expect(launchApp('com.example')).toBe(false);
  });

  it('survives a bridge whose property access throws (Java bridges can)', () => {
    global.FullyKiosk = new Proxy({}, { get() { throw new Error('bridge blew up'); } });
    expect(() => screenOff()).not.toThrow();
    expect(screenOff()).toBe(false);
    expect(() => bindBackButton()).not.toThrow();
  });
});

describe('fkb screenOff/screenOn', () => {
  afterEach(() => {
    delete global.fully;
    delete global.FullyKiosk;
    vi.restoreAllMocks();
  });

  // A control interface under EITHER name works. The Portal does not have one
  // (see the capability suite above), but a device that exposes the methods on
  // `FullyKiosk` rather than `fully` must still be driven — testing only the
  // alias is what let a fully covered module ship fully broken.
  it('screenOff works through a control interface named FullyKiosk, not just `fully`', () => {
    const turnScreenOff = vi.fn();
    global.FullyKiosk = { turnScreenOff };
    expect(screenOff()).toBe(true);
    expect(turnScreenOff).toHaveBeenCalledTimes(1);
  });

  it('screenOn works through the native FullyKiosk object too', () => {
    const turnScreenOn = vi.fn();
    global.FullyKiosk = { turnScreenOn };
    expect(screenOn()).toBe(true);
    expect(turnScreenOn).toHaveBeenCalledTimes(1);
  });

  it('prefers the `fully` alias when both are present', () => {
    const aliased = vi.fn();
    const native = vi.fn();
    global.fully = { turnScreenOff: aliased };
    global.FullyKiosk = { turnScreenOff: native };
    expect(screenOff()).toBe(true);
    expect(aliased).toHaveBeenCalledTimes(1);
    expect(native).not.toHaveBeenCalled();
  });

  it('screenOff calls fully.turnScreenOff and returns true when available', () => {
    const turnScreenOff = vi.fn();
    global.fully = { turnScreenOff };
    expect(screenOff()).toBe(true);
    expect(turnScreenOff).toHaveBeenCalledTimes(1);
  });

  it('screenOn calls fully.turnScreenOn and returns true when available', () => {
    const turnScreenOn = vi.fn();
    global.fully = { turnScreenOn };
    expect(screenOn()).toBe(true);
    expect(turnScreenOn).toHaveBeenCalledTimes(1);
  });

  it('returns false when FKB is not present', () => {
    expect(typeof global.fully).toBe('undefined');
    expect(screenOff()).toBe(false);
    expect(screenOn()).toBe(false);
  });

  it('returns false when fully lacks the method (never throws)', () => {
    global.fully = {};
    expect(screenOff()).toBe(false);
    expect(screenOn()).toBe(false);
  });

  it('contains bridge failures and reports that the action was not handled', () => {
    global.fully = {
      turnScreenOff: vi.fn(() => { throw new Error('bridge down'); }),
      turnScreenOn: vi.fn(() => { throw new Error('bridge down'); }),
    };
    expect(() => screenOff()).not.toThrow();
    expect(() => screenOn()).not.toThrow();
    expect(screenOff()).toBe(false);
    expect(screenOn()).toBe(false);
  });
});
