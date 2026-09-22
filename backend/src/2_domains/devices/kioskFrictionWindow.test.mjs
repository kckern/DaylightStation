import { describe, it, expect } from 'vitest';
import { recordFrictionPing, frictionScore } from './kioskFrictionWindow.mjs';

describe('kioskFrictionWindow', () => {
  it('starts empty and scores zero', () => {
    expect(frictionScore([], { at: 1000, windowMs: 60000 })).toBe(0);
  });

  it('counts a ping recorded inside the window', () => {
    const events = recordFrictionPing([], { at: 1000, windowMs: 60000 });
    expect(frictionScore(events, { at: 1000, windowMs: 60000 })).toBe(1);
  });

  it('drops a ping once it ages out of the window', () => {
    let events = recordFrictionPing([], { at: 0, windowMs: 60000 });
    events = recordFrictionPing(events, { at: 30000, windowMs: 60000 });
    expect(frictionScore(events, { at: 30000, windowMs: 60000 })).toBe(2);
    expect(frictionScore(events, { at: 61001, windowMs: 60000 })).toBe(1);
  });

  it('does not mutate the input array', () => {
    const events = Object.freeze(recordFrictionPing([], { at: 0, windowMs: 60000 }));
    expect(() => recordFrictionPing(events, { at: 1, windowMs: 60000 })).not.toThrow();
  });

  it('recordFrictionPing itself prunes stale events, so state never grows unbounded', () => {
    let events = recordFrictionPing([], { at: 0, windowMs: 1000 });
    events = recordFrictionPing(events, { at: 5000, windowMs: 1000 });
    expect(events).toHaveLength(1);
    expect(events[0].at).toBe(5000);
  });
});
