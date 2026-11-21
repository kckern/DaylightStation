import { describe, it, expect } from 'vitest';
import { createKeyAttributor } from './keyTestModel.js';

describe('createKeyAttributor', () => {
  const make = (address = 'AA:BB:CC:00:00:02') => {
    let t = 0; const timers = [];
    const counted = []; const others = [];
    const a = createKeyAttributor({
      address, windowMs: 400, now: () => t,
      setTimer: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; },
      clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
      onCount: (k, via) => counted.push([k, via]), onOther: (k, from) => others.push([k, from]),
    });
    const advance = (ms) => { t += ms; timers.filter((h) => h.at <= t).forEach((h) => { timers.splice(timers.indexOf(h), 1); h.fn(); }); };
    return { a, counted, others, advance };
  };

  it('counts the tested remote once when the browser copy arrives first', () => {
    const { a, counted, advance } = make();
    a.browser('AudioVolumeUp');
    advance(40);
    a.tagged({ address: 'aa:bb:cc:00:00:02', key: 'AudioVolumeUp', state: 'down' });
    advance(1000);
    expect(counted).toEqual([['AudioVolumeUp', 'remote']]);
  });

  it('does not count the identical remote of the same model', () => {
    const { a, counted, others, advance } = make();
    a.tagged({ address: 'AA:BB:CC:00:00:01', key: 'AudioVolumeUp', state: 'down' });
    advance(30);
    a.browser('AudioVolumeUp');
    advance(1000);
    expect(counted).toEqual([]);
    expect(others).toEqual([['AudioVolumeUp', 'AA:BB:CC:00:00:01']]);
  });

  it('counts a browser key that has no tagged twin (a device the garage does not read)', () => {
    const { a, counted, advance } = make();
    a.browser('x');
    advance(500);
    expect(counted).toEqual([['x', 'browser']]);
  });

  it('ignores releases', () => {
    const { a, counted } = make();
    a.tagged({ address: 'AA:BB:CC:00:00:02', key: 'AudioVolumeUp', state: 'up' });
    expect(counted).toEqual([]);
  });
});
