import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screenOff, screenOn, bindBackButton, onResume, launchApp } from './fkb.js';

/**
 * THE NATIVE OBJECT IS NOT THE ALIAS.
 *
 * `FullyKiosk` is what Android's `addJavascriptInterface` attaches: exactly the
 * `@JavascriptInterface` methods and nothing else. `fully` is a richer JS alias
 * FKB injects on top, and it alone carries `bind`. Treating the two as
 * interchangeable blanked the school Portal for eighty minutes — `bindBackButton`
 * runs at app startup behind a presence check, so `bind is not a function`
 * threw before React mounted and no error listener existed yet to see it.
 *
 * These pin CAPABILITY, not presence: a bridge that is missing a method must
 * make the call a no-op, never a throw.
 */
describe('fkb bridge: the native object lacks the alias-only methods', () => {
  afterEach(() => {
    delete global.fully;
    delete global.FullyKiosk;
    vi.restoreAllMocks();
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

  // THE NATIVE OBJECT, WHICH IS THE ONE THE SCHOOL PORTAL ACTUALLY HAS.
  // `FullyKiosk` is what Android's `addJavascriptInterface` attaches; `fully`
  // is a JS alias FKB injects on top of it, and on the Portal (Android 9, FKB
  // 1.60.1 PLUS, interface enabled) that alias never lands — probed on-device
  // after the button had been silently dead. Testing only the alias is what
  // let this ship: the module was fully covered and fully broken.
  it('screenOff works through the native FullyKiosk object, not just the `fully` alias', () => {
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
