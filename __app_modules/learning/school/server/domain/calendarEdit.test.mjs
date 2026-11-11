import { describe, it, expect } from 'vitest';
import {
  effectiveDay, lockedDayChanges, keepListChanges, keepListBlocked, buildCalendarBlock,
} from './calendarEdit.mjs';
import { DEFAULT_DAY_OFF_POLICY } from './dayOffPolicy.mjs';

const brk = (from, to, tier, extra = {}) => ({ from, to, label: 'Break', tier, ...extra });
const cal = (...except) => ({ except });

describe('effectiveDay', () => {
  it('reads the tier and the school-day verdict together', () => {
    expect(effectiveDay('2026-11-11', cal(brk('2026-11-11', '2026-11-11', 'stay-home'))))
      .toEqual({ schoolDay: false, tier: 'stay-home', replaces: null, assignment: null });
    expect(effectiveDay('2026-11-12', null)).toEqual({ schoolDay: true, tier: null, replaces: null, assignment: null });
  });
});

describe('lockedDayChanges', () => {
  const today = '2026-11-11';
  it('adding a future break touches no locked day', () => {
    expect(lockedDayChanges({ before: cal(), after: cal(brk('2026-11-20', '2026-11-21', 'away')), today })).toEqual([]);
  });
  it('changing a past break tier locks its days', () => {
    expect(lockedDayChanges({
      before: cal(brk('2026-11-02', '2026-11-03', 'away')),
      after: cal(brk('2026-11-02', '2026-11-03', 'stay-home')),
      today,
    })).toEqual(['2026-11-02', '2026-11-03']);
  });
  it('a label-only change on a past break is allowed', () => {
    expect(lockedDayChanges({
      before: cal(brk('2026-11-02', '2026-11-03', 'away')),
      after: cal({ ...brk('2026-11-02', '2026-11-03', 'away'), label: 'Renamed' }),
      today,
    })).toEqual([]);
  });
  it('an in-progress trip may end today but not before', () => {
    const before = cal(brk('2026-11-08', '2026-11-14', 'away'));
    expect(lockedDayChanges({ before, after: cal(brk('2026-11-08', '2026-11-11', 'away')), today })).toEqual([]);
    expect(lockedDayChanges({ before, after: cal(brk('2026-11-08', '2026-11-10', 'away')), today })).toEqual([]);
    expect(lockedDayChanges({ before, after: cal(brk('2026-11-08', '2026-11-09', 'away')), today })).toEqual(['2026-11-10']);
  });
  it('removing a break that ended yesterday locks yesterday', () => {
    expect(lockedDayChanges({ before: cal(brk('2026-11-10', '2026-11-10', 'stay-home')), after: cal(), today }))
      .toEqual(['2026-11-10']);
  });
  it('a past assignment change is locked', () => {
    const b = brk('2026-11-05', '2026-11-05', 'major-holiday', { assignment: 'holiday-a' });
    expect(lockedDayChanges({ before: cal(b), after: cal({ ...b, assignment: 'holiday-b' }), today })).toEqual(['2026-11-05']);
  });
});

describe('keep-lists', () => {
  it('keepListChanges is order-insensitive', () => {
    const after = { ...DEFAULT_DAY_OFF_POLICY, 'stay-home': { keep: [...DEFAULT_DAY_OFF_POLICY['stay-home'].keep].reverse() } };
    expect(keepListChanges({ beforePolicy: DEFAULT_DAY_OFF_POLICY, afterPolicy: after })).toEqual([]);
    const fewer = { ...DEFAULT_DAY_OFF_POLICY, 'major-holiday': { keep: [] } };
    expect(keepListChanges({ beforePolicy: DEFAULT_DAY_OFF_POLICY, afterPolicy: fewer })).toEqual(['major-holiday']);
  });
  it('keepListBlocked names the tier when yesterday was that tier', () => {
    const schedule = cal(brk('2026-11-10', '2026-11-10', 'stay-home'));
    expect(keepListBlocked({ changedTiers: ['stay-home'], schedule, yesterday: '2026-11-10' })).toBe('stay-home');
    expect(keepListBlocked({ changedTiers: ['away'], schedule, yesterday: '2026-11-10' })).toBeNull();
    expect(keepListBlocked({ changedTiers: ['stay-home'], schedule, yesterday: '2026-11-09' })).toBeNull();
  });
});

describe('buildCalendarBlock', () => {
  it('orders span keys, drops empties and keeps also', () => {
    const block = buildCalendarBlock({
      except: [{ tier: 'enrichment', assignment: 'u', replaces: 'science', label: 'L', to: '2026-12-02', from: '2026-12-01' }],
      also: [],
    });
    expect(Object.keys(block.except[0])).toEqual(['from', 'to', 'label', 'tier', 'replaces', 'assignment']);
    expect(block.also).toBeUndefined();
    expect(buildCalendarBlock({ except: [], also: [] })).toBeNull();
  });
});
