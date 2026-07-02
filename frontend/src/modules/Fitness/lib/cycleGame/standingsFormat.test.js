import { describe, it, expect } from 'vitest';
import { ordinal, fmtTime, gapToAboveText, finishedMetricText } from './standingsFormat.js';

describe('ordinal', () => {
  it('formats 1st/2nd/3rd/4th and the 11-13 / 21 exceptions', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(21)).toBe('21st');
  });
  it('returns empty string for non-finite input', () => {
    expect(ordinal(null)).toBe('');
    expect(ordinal(undefined)).toBe('');
    expect(ordinal(NaN)).toBe('');
  });
});

describe('fmtTime', () => {
  it('formats seconds as m:ss', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(9)).toBe('0:09');
    expect(fmtTime(272)).toBe('4:32');
    expect(fmtTime(310)).toBe('5:10');
  });
  it('never renders ":60" for fractional times near a minute boundary', () => {
    // Interpolated finishes are fractional; floor-minutes/round-remainder
    // rendered 119.6 as "1:60". Total-seconds rounding gives "2:00".
    expect(fmtTime(119.6)).toBe('2:00');
    expect(fmtTime(59.7)).toBe('1:00');
    expect(fmtTime(119.4)).toBe('1:59');
  });
  it('returns an em dash for non-finite input', () => {
    expect(fmtTime(null)).toBe('—');
    expect(fmtTime(undefined)).toBe('—');
    expect(fmtTime(NaN)).toBe('—');
  });
});

describe('gapToAboveText — gap math for both win conditions (audit UX §4.1)', () => {
  it('distance races: a raw metre gap', () => {
    expect(gapToAboveText({ winCondition: 'distance', gapM: 12, abovePaceKmh: 0 })).toBe('−12 m');
  });
  it('time races: the metre gap projected through the pace above into a time-behind estimate', () => {
    // 40 m at 36 km/h (= 10 m/s) takes 4 s to close.
    expect(gapToAboveText({ winCondition: 'time', gapM: 40, abovePaceKmh: 36 })).toBe('−0:04');
  });
  it('time races fall back to a metre gap when the pace above is unusable (stopped/boxed)', () => {
    expect(gapToAboveText({ winCondition: 'time', gapM: 12, abovePaceKmh: 0 })).toBe('−12 m');
  });
  it('clamps a negative gap (sort noise) to zero', () => {
    expect(gapToAboveText({ winCondition: 'distance', gapM: -5, abovePaceKmh: 0 })).toBe('−0 m');
  });
});

describe('finishedMetricText — a genuine finisher\'s own metric (T9 review)', () => {
  it('distance races: finish TIME (everyone finishes at the same distance, so distance can\'t differentiate them)', () => {
    expect(finishedMetricText({ winCondition: 'distance', finishTimeS: 272, distanceM: 3000 })).toBe('4:32');
  });
  it('time races: distance covered (everyone finishes at the same elapsed time)', () => {
    expect(finishedMetricText({ winCondition: 'time', finishTimeS: 600, distanceM: 820 })).toBe('820 m');
  });
});
