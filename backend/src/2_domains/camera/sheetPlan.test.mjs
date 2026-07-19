/**
 * Contact-sheet planning tests.
 *
 * The behaviour that matters most is coverage: every hour of the day should be
 * represented by either an event sheet or an hourly sheet, with no silent gaps
 * and no hourly sheet duplicating an hour an event already covers.
 */

import { describe, it, expect } from 'vitest';
import { planContactSheets, sampleRateFor, sheetName, exifTimestamp, localEpochSeconds, primaryLabel } from './sheetPlan.mjs';

const DAY = '2026-07-17';
const at = (h, m = 0, s = 0) => new Date(2026, 6, 17, h, m, s);
const session = (fromH, fromM, toH, toM, labels = []) => ({
  start: at(fromH, fromM),
  end: at(toH, toM),
  labels,
});

describe('planContactSheets', () => {
  it('fills a day with no events with 24 hourly sheets', () => {
    const plan = planContactSheets([], DAY);
    expect(plan).toHaveLength(24);
    expect(plan.every((p) => p.kind === 'hour')).toBe(true);
  });

  it('replaces an hour with an event sheet rather than adding to it', () => {
    const plan = planContactSheets([session(14, 5, 14, 6, ['person'])], DAY);
    expect(plan.filter((p) => p.kind === 'event')).toHaveLength(1);
    // 23 hourly sheets: hour 14 is covered by the event
    expect(plan.filter((p) => p.kind === 'hour')).toHaveLength(23);
    expect(plan.some((p) => p.kind === 'hour' && p.start.getHours() === 14)).toBe(false);
  });

  it('splits a session longer than an hour into equal chunks', () => {
    // 09:00-11:30 — kids in the yard
    const plan = planContactSheets([session(9, 0, 11, 30, ['person'])], DAY);
    const events = plan.filter((p) => p.kind === 'event');
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.end - e.start <= 3600_000)).toBe(true);
    expect(events.map((e) => e.part)).toEqual([1, 2, 3]);
    // hours 9, 10 and 11 are all covered
    for (const h of [9, 10, 11]) {
      expect(plan.some((p) => p.kind === 'hour' && p.start.getHours() === h)).toBe(false);
    }
  });

  it('covers every hour exactly once across a mixed day', () => {
    const plan = planContactSheets(
      [session(8, 15, 8, 45, ['person']), session(13, 0, 15, 0, ['pet'])],
      DAY,
    );
    const hourly = plan.filter((p) => p.kind === 'hour').map((p) => p.start.getHours());
    expect(new Set(hourly).size).toBe(hourly.length); // no duplicates
    // 8, 13, 14 covered by events -> 21 hourly
    expect(hourly).toHaveLength(21);
    expect(hourly).not.toContain(8);
    expect(hourly).not.toContain(13);
  });

  it('clamps a session running past midnight to the day', () => {
    const plan = planContactSheets(
      [{ start: at(23, 30), end: new Date(2026, 6, 18, 1, 0), labels: ['person'] }],
      DAY,
    );
    const events = plan.filter((p) => p.kind === 'event');
    expect(events.every((e) => e.end <= new Date(2026, 6, 18, 0, 0, 0, 1))).toBe(true);
  });

  it('ignores zero-length or inverted sessions', () => {
    const plan = planContactSheets([session(10, 0, 10, 0)], DAY);
    expect(plan.filter((p) => p.kind === 'event')).toHaveLength(0);
    expect(plan.filter((p) => p.kind === 'hour')).toHaveLength(24);
  });

  it('returns the plan in chronological order', () => {
    const plan = planContactSheets([session(20, 0, 20, 30), session(3, 0, 3, 30)], DAY);
    const times = plan.map((p) => p.start.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe('sampleRateFor', () => {
  it('gives a short event a dense sample rate', () => {
    // 30-second doorbell ring, 36 tiles -> ~1.2 fps, so the visitor is actually visible
    expect(sampleRateFor(30_000, 36)).toBeCloseTo(1.2, 2);
  });

  it('gives a full hour a sparse rate', () => {
    expect(sampleRateFor(3600_000, 36)).toBeCloseTo(0.01, 4);
  });

  it('never exceeds the source frame rate', () => {
    // 2-second event: 18 fps would be requested, but the source only has 10
    expect(sampleRateFor(2000, 36, 10)).toBe(10);
  });

  it('honours a minimum gap so short events do not fill with near-duplicates', () => {
    // 10s span, 24 tiles would be 0.4s apart; a 2s floor caps it at 0.5 fps
    expect(sampleRateFor(10_000, 24, 10, 2)).toBe(0.5);
  });

  it('leaves already-sparse spans untouched by the minimum gap', () => {
    // an hour is far sparser than the floor, so the floor must not raise it
    expect(sampleRateFor(3600_000, 24, 10, 2)).toBeCloseTo(24 / 3600, 6);
  });

  it('treats a zero minimum gap as no constraint', () => {
    expect(sampleRateFor(10_000, 24, 10, 0)).toBeCloseTo(2.4, 4);
  });
});

describe('sheetName', () => {
  it('carries a full LOCAL date so the file survives leaving its folder', () => {
    expect(sheetName({ kind: 'hour', start: at(2), labels: [] })).toBe('2026-07-17_020000-hour');
  });

  it('names event sheets by local timestamp and label', () => {
    expect(sheetName({ kind: 'event', start: at(18, 1, 3), labels: ['person'] })).toBe(
      '2026-07-17_180103-person',
    );
  });

  it('marks split parts so ordering stays obvious', () => {
    expect(sheetName({ kind: 'event', start: at(9, 0), labels: ['person'], part: 2, parts: 3 })).toBe(
      '2026-07-17_090000-person-p2of3',
    );
  });

  it('falls back to motion when unlabelled', () => {
    expect(sheetName({ kind: 'event', start: at(5, 7), labels: [] })).toBe('2026-07-17_050700-motion');
  });

  it('sorts chronologically as plain strings', () => {
    const names = [at(9, 0), at(10, 0), at(2, 0)].map((d) => sheetName({ kind: 'hour', start: d, labels: [] }));
    expect([...names].sort()).toEqual([names[2], names[0], names[1]]);
  });
});

describe('exifTimestamp', () => {
  it('emits EXIF-format LOCAL time', () => {
    expect(exifTimestamp(at(18, 1, 3))).toBe('2026:07:17 18:01:03');
  });
});

describe('localEpochSeconds', () => {
  it('shifts the epoch so gmtime renders local wall-clock', () => {
    const d = at(18, 0, 0);
    // gmtime of the shifted epoch must read back as 18:00 UTC
    const asUtc = new Date(localEpochSeconds(d) * 1000);
    expect(asUtc.getUTCHours()).toBe(18);
    expect(asUtc.getUTCMinutes()).toBe(0);
  });

  it('differs from a plain epoch by the zone offset', () => {
    const d = at(12, 0, 0);
    expect(localEpochSeconds(d)).not.toBe(Math.floor(d.getTime() / 1000));
  });
});

describe('primaryLabel', () => {
  it('prefers person over the co-occurring motion label', () => {
    // HA sessions almost always carry 'motion' alongside the real detection;
    // labels[0] used to bury every person event as "motion"
    expect(primaryLabel(['motion', 'vehicle', 'person', 'pet'])).toBe('person');
  });

  it('falls through the priority order', () => {
    expect(primaryLabel(['motion', 'vehicle'])).toBe('vehicle');
    expect(primaryLabel(['motion'])).toBe('motion');
  });

  it('defaults to motion when unlabelled', () => {
    expect(primaryLabel([])).toBe('motion');
  });
});
