import { describe, it, expect } from 'vitest';
import { xOf, linePath, intervalRects, markXs, hourTicks, dayWindow } from './laneGeometry.js';
import { formatLaneTotal } from './formatLaneTotal.js';

const w = { startMs: 0, endMs: 1000 };
describe('laneGeometry', () => {
  it('maps time onto a 0..1000 viewBox', () => { expect(xOf(250, w)).toBe(250); expect(markXs([0, 1000], w)).toEqual([0, 1000]); });
  it('a gap breaks the area into two shapes', () => {
    const d = linePath([{ t: 0, v: 1 }, { t: 100, v: 2 }, { t: 200, v: null }, { t: 300, v: 1 }, { t: 400, v: 1 }], w, { height: 20, maxV: 2 });
    expect(d.match(/M/g)).toHaveLength(2);
  });
  it('a short interval is still visible', () => { expect(intervalRects([{ from: 10, to: 10.2 }], w)[0].width).toBe(1); });
  it('ticks every 6 h of a local day', () => {
    const day = { startMs: Date.parse('2026-10-28T07:00:00Z'), endMs: Date.parse('2026-10-29T07:00:00Z') };
    expect(hourTicks(day, 'America/Los_Angeles').map((t) => t.label)).toEqual(['12a', '6a', '12p', '6p']);
    expect(hourTicks(day, 'America/Los_Angeles').map((t) => t.x)).toEqual([0, 250, 500, 750]);
  });
  it('a 25 h day (DST ends) puts 6a an hour later than a quarter of the way', () => {
    const day = dayWindow({ day: '2026-11-01', startIso: '2026-11-01T07:00:00.000Z', endIso: '2026-11-02T08:00:00.000Z' }, 'America/Los_Angeles');
    expect(day.endMs - day.startMs).toBe(25 * 3_600_000);
    const six = hourTicks(day, 'America/Los_Angeles').find((t) => t.label === '6a');
    expect(six.x).toBeCloseTo((7 / 25) * 1000, 5);
  });
  it("today's window runs to the coming midnight, with now inside it", () => {
    const day = dayWindow({ day: '2026-10-28', startIso: '2026-10-28T07:00:00.000Z', endIso: '2026-10-28T19:00:00.000Z' }, 'America/Los_Angeles');
    expect(new Date(day.endMs).toISOString()).toBe('2026-10-29T07:00:00.000Z');
    expect(new Date(day.nowMs).toISOString()).toBe('2026-10-28T19:00:00.000Z');
  });
});
describe('formatLaneTotal', () => {
  it.each([
    ['power', { kwh: 16.34 }, '16.3 kWh'], ['events', { count: 1 }, '1 ring'], ['events', { count: 0 }, 'No rings'],
    ['occupancy', { hours: 3.3333 }, '3 h 20 m'], ['occupancy', { hours: 0.6667 }, '40 m'],
    ['screen', { hours: 2.1667, kwh: 0.42 }, '2 h 10 m · 0.4 kWh'], ['screen', { hours: 0, kwh: 0 }, 'Off'],
    ['events', { count: null }, ''], ['occupancy', { hours: null }, ''],
    ['occupancy', { hours: 0 }, 'Empty'], ['screen', { hours: 135.97, kwh: 0.36 }, '136 h · 0.4 kWh'],
    ['screen', { hours: 1, kwh: null }, '1 h'], ['occupancy', { hours: 0.004 }, '< 1 m'],
  ])('%s %j → %s', (kind, total, text) => { expect(formatLaneTotal(kind, total)).toBe(text); });
});
