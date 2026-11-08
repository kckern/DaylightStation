import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/lib/logging/Logger.js', () => {
  const logger = { child: () => logger, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, sampled: () => {} };
  return { default: () => logger };
});
const clock = vi.hoisted(() => ({ subs: new Set(), onTick: null, stop: null }));
vi.mock('../../../../../../__capabilities/gaming/browser/platform/realtime/index.js', () => ({
  createTickLerp: () => ({
    onTick: (...a) => clock.onTick(...a),
    subscribe: (cb) => { clock.subs.add(cb); return () => clock.subs.delete(cb); },
    stop: (...a) => clock.stop(...a),
  }),
}));
import RiderHrTrend, { TREND_FRAME_MIN_MS } from './RiderHrTrend.jsx';

const zones = [
  { id: 'cool', threshold: 0 }, { id: 'active', threshold: 100 }, { id: 'warm', threshold: 120 },
  { id: 'hot', threshold: 140 }, { id: 'fire', threshold: 160 },
];
let now = 0;
const frame = (f) => { now += 100; clock.subs.forEach((cb) => cb(f)); };
const pathOf = (c) => c.querySelector('path.rider-hr-trend__line');
const lastPoint = (c) => {
  const pairs = [...pathOf(c).getAttribute('d').matchAll(/(-?[\d.]+),(-?[\d.]+)/g)];
  return pairs.at(-1).slice(1).map(Number);
};
const scaleOf = (c) => Number(c.querySelector('.rider-hr-trend__plot').getAttribute('transform').split(' ')[3]);

function setup(readings = [120, 125, 130, 135, 140, 145]) {
  const s = { heart_rate: [...readings] };
  const props = { participantId: '|rider-a', profileId: 'rider-a', cardHeight: 200, tickMs: 5000, zones, getSeries: (_i, m) => s[m] };
  const view = render(<RiderHrTrend {...props} tickCount={s.heart_rate.length} />);
  const tick = (...values) => {
    s.heart_rate.push(...values);
    view.rerender(<RiderHrTrend {...props} tickCount={s.heart_rate.length} />);
  };
  return { ...view, tick };
}

beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  clock.subs.clear();
  clock.onTick = vi.fn();
  clock.stop = vi.fn();
  window.matchMedia = vi.fn(() => ({ matches: false }));
});
afterEach(() => vi.restoreAllMocks());

describe('RiderHrTrend motion', () => {
  it('at f=0 the tip sits on the previous reading; at f=1 on the new one', () => {
    const { container, tick } = setup();
    tick(160);
    expect(clock.onTick).toHaveBeenCalledTimes(1);
    expect(lastPoint(container)).toEqual([100, 145]);
    frame(0.5);
    expect(lastPoint(container)).toEqual([100, 152.5]);
    frame(1);
    expect(lastPoint(container)).toEqual([100, 160]);
  });

  it('glides the y-range rather than snapping it', () => {
    const { container, tick } = setup();
    const before = scaleOf(container); // range [90,170] → -1.25
    tick(190); // range widens to [90,190] → -1
    expect(scaleOf(container)).toBeCloseTo(before, 4);
    frame(0.5);
    expect(scaleOf(container)).toBeCloseTo(-100 / 90, 3);
    frame(1);
    expect(scaleOf(container)).toBeCloseTo(-1, 4);
  });

  it('a tickCount jump of 3 lands directly on the newest state', () => {
    const { container, tick } = setup();
    tick(150, 151, 152);
    expect(clock.onTick).not.toHaveBeenCalled();
    expect(lastPoint(container)).toEqual([100, 152]);
  });

  it('reduced motion writes the final state only', () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));
    const { container, tick } = setup();
    tick(160);
    expect(lastPoint(container)).toEqual([100, 160]);
    frame(0.5);
    expect(lastPoint(container)).toEqual([100, 160]);
  });

  it('caps writes at ~30 fps', () => {
    const { container, tick } = setup();
    tick(160);
    const spy = vi.spyOn(pathOf(container), 'setAttribute');
    frame(0.3);
    now += TREND_FRAME_MIN_MS - 100 - 20; // next frame lands 20ms short of the cap
    frame(0.4);
    expect(spy.mock.calls.filter(([a]) => a === 'd')).toHaveLength(1);
  });

  it('unmount stops the clock', () => {
    const { unmount } = setup();
    unmount();
    expect(clock.stop).toHaveBeenCalled();
  });
});
