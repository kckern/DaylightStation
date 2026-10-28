import { describe, it, expect } from 'vitest';
import { dayWindows, localMidnight, bucketLine, toIntervals, risingEdges, sumIntervalsMs,
  dailyCounterTotal, counterDelta, integrateKwh } from './historySeries.mjs';

const TZ = 'America/Los_Angeles';
const at = (iso) => Date.parse(iso);
const isOn = (v) => v === 'on';

describe('dayWindows', () => {
  it('today runs from local midnight to now', () => {
    expect(dayWindows('today', { nowMs: at('2026-10-28T18:30:00Z'), timeZone: TZ }))
      .toEqual([{ day: '2026-10-28', startMs: at('2026-10-28T07:00:00Z'), endMs: at('2026-10-28T18:30:00Z') }]);
  });
  it('yesterday is a full local day; a fall-back day is 25 hours', () => {
    const [w] = dayWindows('yesterday', { nowMs: at('2026-11-02T18:00:00Z'), timeZone: TZ });
    expect(w).toEqual({ day: '2026-11-01', startMs: at('2026-11-01T07:00:00Z'), endMs: at('2026-11-02T08:00:00Z') });
  });
  it('a spring-forward day is 23 hours', () => {
    expect(localMidnight(at('2027-03-15T12:00:00Z'), TZ) - localMidnight(at('2027-03-14T12:00:00Z'), TZ)).toBe(23 * 3600e3);
  });
  it('week is seven days, oldest first, today last and partial', () => {
    const w = dayWindows('week', { nowMs: at('2026-10-28T18:30:00Z'), timeZone: TZ });
    expect(w.map((d) => d.day)).toEqual(['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
    expect(w[6].endMs).toBe(at('2026-10-28T18:30:00Z'));
  });
});

describe('bucketLine', () => {
  const start = 0; const end = 4 * 60e3;
  it('time-weights a held value and carries the pre-window value in', () => {
    const s = [{ t: -60e3, v: 100 }, { t: 30e3, v: 300 }];
    const b = bucketLine(s, { startMs: start, endMs: end, buckets: 4 });
    expect(b[0]).toEqual({ t: 0, v: 200, max: 300 });     // half at 100, half at 300
    expect(b[1]).toEqual({ t: 60e3, v: 300, max: 300 });
  });
  it('an unavailable stretch is a gap, not a zero', () => {
    const s = [{ t: 0, v: 100 }, { t: 60e3, v: null }, { t: 120e3, v: 100 }];
    const b = bucketLine(s, { startMs: start, endMs: end, buckets: 4 });
    expect(b[1]).toEqual({ t: 60e3, v: null, max: null });
    expect(b[2].v).toBe(100);
  });
  it('never returns more than the bucket budget', () => {
    const s = Array.from({ length: 5000 }, (_, i) => ({ t: i * 10, v: i }));
    expect(bucketLine(s, { startMs: 0, endMs: 50000, buckets: 288 })).toHaveLength(288);
  });
});

describe('toIntervals / risingEdges', () => {
  const day = { startMs: at('2026-10-28T07:00:00Z'), endMs: at('2026-10-29T07:00:00Z') };
  it('clips an occupancy carried in from before midnight to midnight', () => {
    const s = [{ t: at('2026-10-28T06:50:00Z'), v: 'on' }, { t: at('2026-10-28T07:40:00Z'), v: 'off' }];
    expect(toIntervals(s, { ...day, isOn })).toEqual([{ from: day.startMs, to: at('2026-10-28T07:40:00Z') }]);
  });
  it('merges gaps under two minutes and counts null as off', () => {
    const s = [{ t: day.startMs + 0, v: 'on' }, { t: day.startMs + 60e3, v: 'off' }, { t: day.startMs + 90e3, v: 'on' },
      { t: day.startMs + 600e3, v: null }, { t: day.startMs + 900e3, v: 'on' }, { t: day.startMs + 960e3, v: 'off' }];
    expect(toIntervals(s, { ...day, isOn })).toEqual([
      { from: day.startMs, to: day.startMs + 600e3 }, { from: day.startMs + 900e3, to: day.startMs + 960e3 }]);
  });
  it('a carried-in on and a null->on are not rings', () => {
    const s = [{ t: day.startMs - 5e3, v: 'on' }, { t: day.startMs + 10e3, v: 'off' }, { t: day.startMs + 20e3, v: null },
      { t: day.startMs + 30e3, v: 'on' }, { t: day.startMs + 40e3, v: 'off' }, { t: day.startMs + 50e3, v: 'on' }];
    expect(risingEdges(s, { ...day, isOn })).toEqual([day.startMs + 50e3]);
  });
  it('hours never exceed the window', () => {
    const s = [{ t: day.startMs - 1, v: 'on' }];
    expect(sumIntervalsMs(toIntervals(s, { ...day, isOn }))).toBe(day.endMs - day.startMs);
  });
});

describe('energy totals', () => {
  const day = { startMs: 0, endMs: 24 * 3600e3 };
  it('a daily counter ignores the carried-in pre-reset total', () => {
    expect(dailyCounterTotal([{ t: -1, v: 40 }, { t: 20e3, v: 0 }, { t: 3600e3, v: 12 }], day)).toBe(12);
  });
  it('a reset just before the window ends keeps the pre-reset value', () => {
    expect(dailyCounterTotal([{ t: 3600e3, v: 30 }, { t: day.endMs - 5e3, v: 0 }], day)).toBe(30);
  });
  it('a total_increasing meter sums only increments', () => {
    expect(counterDelta([{ t: -1, v: 10 }, { t: 100, v: 10.5 }, { t: 200, v: 0.2 }, { t: 300, v: 0.4 }], day)).toBeCloseTo(0.9);
  });
  it('watts integrate to kWh, skipping unavailable time', () => {
    expect(integrateKwh([{ t: 0, v: 1000 }, { t: 3600e3, v: null }, { t: 7200e3, v: 0 }], day)).toBeCloseTo(1);
  });
  it('no numeric points is null, not zero', () => {
    expect(dailyCounterTotal([], day)).toBeNull();
    expect(integrateKwh([{ t: 0, v: null }], day)).toBeNull();
  });
});
