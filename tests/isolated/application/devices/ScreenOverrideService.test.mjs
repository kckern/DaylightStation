import { describe, it, expect } from 'vitest';
import { ScreenOverrideService } from '#apps/devices/services/ScreenOverrideService.mjs';

function makeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('ScreenOverrideService', () => {
  it('set() stores a state + expiry computed from minutes', () => {
    const clock = makeClock();
    const svc = new ScreenOverrideService({ clock });
    const r = svc.set('dev', 'off', 30);
    expect(r).toEqual({ state: 'off', until: 1_000_000 + 30 * 60_000 });
    expect(svc.get('dev')).toEqual({ state: 'off', until: 1_000_000 + 30 * 60_000 });
  });

  it('get() returns null once the window has expired (and drops it)', () => {
    const clock = makeClock();
    const svc = new ScreenOverrideService({ clock });
    svc.set('dev', 'on', 10);
    clock.advance(10 * 60_000);            // now === until → expired
    expect(svc.get('dev')).toBeNull();
    clock.advance(-1);                      // proof it was deleted, not just time-gated
    expect(svc.get('dev')).toBeNull();
  });

  it('set() replaces an existing window', () => {
    const clock = makeClock();
    const svc = new ScreenOverrideService({ clock });
    svc.set('dev', 'off', 30);
    svc.set('dev', 'on', 5);
    expect(svc.get('dev')).toEqual({ state: 'on', until: 1_000_000 + 5 * 60_000 });
  });

  it('clear() removes the window', () => {
    const clock = makeClock();
    const svc = new ScreenOverrideService({ clock });
    svc.set('dev', 'off', 30);
    svc.clear('dev');
    expect(svc.get('dev')).toBeNull();
  });

  it('get() for an unknown device is null; set() rejects a bad state', () => {
    const svc = new ScreenOverrideService({ clock: makeClock() });
    expect(svc.get('nope')).toBeNull();
    expect(() => svc.set('dev', 'dim', 5)).toThrow();
  });
});
