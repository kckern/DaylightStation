/**
 * Sun calculation tests.
 *
 * These matter because the backfill spans ~95 historical dates and nothing
 * external will tell us when the sun rose on 2026-04-19. If this drifts, every
 * timelapse gets the wrong profile and nobody notices until the output looks
 * wrong months later.
 *
 * Reference values are for the configured location (47.4095, -122.1693,
 * America/Los_Angeles) and are asserted as windows rather than exact times —
 * the goal is catching drift, not certifying an ephemeris.
 */

import { describe, it, expect } from 'vitest';
import { sunTimes, phaseAt, partitionByPhase } from './sun.lib.mjs';

const LAT = 47.4095041;
const LNG = -122.1693485;

describe('sunTimes', () => {
  it('orders sunrise before solar noon before sunset', () => {
    const t = sunTimes('2026-07-17', LAT, LNG);
    expect(t.sunrise.getTime()).toBeLessThan(t.solarNoon.getTime());
    expect(t.solarNoon.getTime()).toBeLessThan(t.sunset.getTime());
  });

  it('puts mid-July sunrise in the 5am hour and sunset around 9pm local', () => {
    const t = sunTimes('2026-07-17', LAT, LNG);
    expect(t.sunrise.getHours()).toBeGreaterThanOrEqual(5);
    expect(t.sunrise.getHours()).toBeLessThanOrEqual(6);
    expect(t.sunset.getHours()).toBeGreaterThanOrEqual(20);
    expect(t.sunset.getHours()).toBeLessThanOrEqual(21);
  });

  it('gives a much longer day at the summer solstice than the winter one', () => {
    const summer = sunTimes('2026-06-21', LAT, LNG);
    const winter = sunTimes('2026-12-21', LAT, LNG);
    const hours = (t) => (t.sunset - t.sunrise) / 3600000;
    expect(hours(summer)).toBeGreaterThan(15);
    expect(hours(winter)).toBeLessThan(9);
  });

  it('resolves historical backfill dates, which is the whole point', () => {
    for (const day of ['2026-04-15', '2026-05-01', '2026-06-01', '2026-07-04']) {
      const t = sunTimes(day, LAT, LNG);
      expect(t.sunrise).toBeInstanceOf(Date);
      expect(t.sunset).toBeInstanceOf(Date);
      expect(Number.isNaN(t.sunrise.getTime())).toBe(false);
    }
  });

  it('lands each result on the requested calendar day', () => {
    const t = sunTimes('2026-07-17', LAT, LNG);
    expect(t.sunrise.getDate()).toBe(17);
    expect(t.sunset.getDate()).toBe(17);
  });

  it('reports polar day above the arctic circle at the solstice', () => {
    const t = sunTimes('2026-06-21', 78.2, 15.6); // Svalbard
    expect(t.polar).toBe('day');
    expect(t.sunrise).toBeNull();
  });
});

describe('phaseAt', () => {
  const times = sunTimes('2026-07-17', LAT, LNG);

  it('classifies midday as day and the small hours as night', () => {
    expect(phaseAt(new Date(2026, 6, 17, 13, 0), times)).toBe('day');
    expect(phaseAt(new Date(2026, 6, 17, 1, 37), times)).toBe('night');
  });

  it('classifies the 18:01 evening activity block as day', () => {
    expect(phaseAt(new Date(2026, 6, 17, 18, 1), times)).toBe('day');
  });

  it('honours offsets that extend the day window past the geometric event', () => {
    const justAfterSunset = new Date(times.sunset.getTime() + 10 * 60000);
    expect(phaseAt(justAfterSunset, times)).toBe('night');
    expect(phaseAt(justAfterSunset, times, { sunset: 20 })).toBe('day');
  });

  it('treats a polar day as entirely day', () => {
    const polar = sunTimes('2026-06-21', 78.2, 15.6);
    expect(phaseAt(new Date(2026, 5, 21, 2, 0), polar)).toBe('day');
  });
});

describe('partitionByPhase', () => {
  it('splits items into day and night buckets', () => {
    const items = [
      { start: new Date(2026, 6, 17, 2, 0) },
      { start: new Date(2026, 6, 17, 13, 0) },
      { start: new Date(2026, 6, 17, 18, 30) },
      { start: new Date(2026, 6, 17, 23, 30) },
    ];
    const out = partitionByPhase(items, '2026-07-17', { latitude: LAT, longitude: LNG });
    expect(out.day).toHaveLength(2);
    expect(out.night).toHaveLength(2);
  });
});
