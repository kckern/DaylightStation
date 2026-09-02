import { describe, test, expect } from 'vitest';
import { realignSeries, planWindow, idToMs, parseClock } from './repairSessionWindow.mjs';

describe('realignSeries', () => {
  const session = () => ({
    timeline: { interval_seconds: 5, tick_count: 3, series: { 'a:hr': '[100,110,120]' } },
  });

  test('pushes the samples back to where they happened', () => {
    const s = session();
    realignSeries(s, 2, 8);
    // Two leading nulls, the three real samples, then padding to the axis.
    expect(JSON.parse(s.timeline.series['a:hr'])).toEqual([[null, 2], 100, 110, 120, [null, 3]]);
    expect(s.timeline.tick_count).toBe(8);
  });

  test('extends the axis to the window even with no lead', () => {
    const s = session();
    realignSeries(s, 0, 6);
    expect(JSON.parse(s.timeline.series['a:hr'])).toEqual([100, 110, 120, [null, 3]]);
  });

  test('re-encodes to the stored string form, not raw arrays', () => {
    const s = session();
    realignSeries(s, 1, 5);
    expect(typeof s.timeline.series['a:hr']).toBe('string');
  });

  test('leaves a session with no series alone', () => {
    const s = { timeline: { interval_seconds: 5, series: {} } };
    expect(realignSeries(s, 5, 10)).toBe(0);
  });
});

describe('planWindow guards', () => {
  const build = (id, start, end, eventStart) => ({
    sessionId: id,
    session: { id, start, end },
    timeline: { events: [{ type: 'media', data: { start: eventStart, end: eventStart + 60_000 } }] },
  });

  test('repairs a start the resume pushed forward', () => {
    const id = '20260901154746';
    const plan = planWindow(build(id, '2026-09-01 16:09:51.102', '2026-09-01 16:29:26.102', idToMs(id) + 1000));
    expect(plan).not.toBeNull();
    expect(plan.startMs).toBe(idToMs(id));
  });

  test('refuses a start EARLIER than the id — that is a merge, not a rebase', () => {
    // Moving this start forward would discard real minutes.
    const id = '20260203061904';
    expect(planWindow(build(id, '2026-02-03 06:01:24.000', '2026-02-03 06:50:00.000', idToMs(id) + 1000))).toBeNull();
  });

  test('refuses when the id does not vouch for the first event', () => {
    const id = '20260617103706';
    const plan = planWindow(build(id, '2026-06-17 10:52:00.000', '2026-06-17 11:07:00.000', idToMs(id) - 917 * 60_000));
    expect(plan).toBeNull();
  });
});
