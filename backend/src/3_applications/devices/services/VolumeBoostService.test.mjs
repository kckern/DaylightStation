import { describe, it, expect } from 'vitest';
import { VolumeBoostService } from './VolumeBoostService.mjs';

const fakeClock = (start = 0) => {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
};

describe('VolumeBoostService', () => {
  it('has no boost for an unknown device', () => {
    expect(new VolumeBoostService().get('portal')).toBeNull();
  });

  it('holds a boost for the requested window', () => {
    const clock = fakeClock();
    const svc = new VolumeBoostService({ clock });

    const entry = svc.set('portal', 85, 30);

    expect(entry).toEqual({ ceiling: 85, until: 30 * 60_000 });
    clock.advance(29 * 60_000);
    expect(svc.get('portal')).toEqual({ ceiling: 85, until: 30 * 60_000 });
  });

  it('expires exactly at the deadline and forgets the entry', () => {
    const clock = fakeClock();
    const svc = new VolumeBoostService({ clock });
    svc.set('portal', 85, 10);

    clock.advance(10 * 60_000);

    expect(svc.get('portal')).toBeNull();
    // A second read must not resurrect it.
    expect(svc.get('portal')).toBeNull();
  });

  it('scopes boosts per device', () => {
    const svc = new VolumeBoostService({ clock: fakeClock() });
    svc.set('portal', 85, 10);
    expect(svc.get('livingroom-tv')).toBeNull();
  });

  it('replaces an existing window rather than stacking', () => {
    const clock = fakeClock();
    const svc = new VolumeBoostService({ clock });
    svc.set('portal', 85, 60);

    svc.set('portal', 70, 5);

    expect(svc.get('portal')).toEqual({ ceiling: 70, until: 5 * 60_000 });
  });

  it('clears on request', () => {
    const svc = new VolumeBoostService({ clock: fakeClock() });
    svc.set('portal', 85, 60);
    svc.clear('portal');
    expect(svc.get('portal')).toBeNull();
  });

  it('treats zero minutes as already expired', () => {
    const svc = new VolumeBoostService({ clock: fakeClock() });
    svc.set('portal', 85, 0);
    expect(svc.get('portal')).toBeNull();
  });

  it('rejects a ceiling outside 0..100', () => {
    const svc = new VolumeBoostService({ clock: fakeClock() });
    for (const bad of [-1, 101, 12.5, 'loud', null]) {
      expect(() => svc.set('portal', bad, 10)).toThrow(/invalid ceiling/);
    }
  });
});
