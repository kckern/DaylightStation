import { AmbientLightTracker } from '../../../backend/src/2_domains/home-automation/AmbientLightTracker.mjs';

describe('AmbientLightTracker', () => {
  it('tracks max across entities and reports changes', () => {
    const t = new AmbientLightTracker({ threshold: 1 });
    expect(t.update('a', '10')).toEqual({ changed: true, lux: 10 });
    expect(t.update('b', '40')).toEqual({ changed: true, lux: 40 });
    // a rises but b still the max → no change
    expect(t.update('a', '12')).toEqual({ changed: false, lux: 40 });
    // b rises → change
    expect(t.update('b', '60')).toEqual({ changed: true, lux: 60 });
  });

  it('ignores non-numeric / unavailable states (keeps last good)', () => {
    const t = new AmbientLightTracker({ threshold: 1 });
    t.update('a', '50');
    expect(t.update('a', 'unavailable')).toEqual({ changed: false, lux: 50 });
    expect(t.max()).toBe(50);
  });

  it('suppresses sub-threshold changes', () => {
    const t = new AmbientLightTracker({ threshold: 1 });
    t.update('a', '50');
    expect(t.update('a', '50.4')).toEqual({ changed: false, lux: 50.4 });
    expect(t.update('a', '52')).toEqual({ changed: true, lux: 52 });
  });

  it('exposes sources', () => {
    const t = new AmbientLightTracker();
    t.update('a', '5');
    t.update('b', '9');
    expect(t.sources()).toEqual({ a: 5, b: 9 });
  });
});
