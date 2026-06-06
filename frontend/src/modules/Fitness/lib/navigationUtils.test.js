import { describe, it, expect } from 'vitest';
import { filterNavItemsByDay } from './navigationUtils.js';

// Day-of-week convention matches JS Date.getDay(): 0=Sunday .. 6=Saturday.
describe('filterNavItemsByDay', () => {
  const home = { type: 'screen', name: 'Home', target: { screen_id: 'home' } };
  const tvSat = { type: 'plex_collection_group', name: 'TV Shows', days: [6], target: { collection_ids: [1] } };
  const weekdays = { type: 'plex_collection', name: 'Work', days: [1, 2, 3, 4, 5], target: { collection_id: 2 } };

  it('keeps items with no `days` field on every day', () => {
    for (let d = 0; d <= 6; d++) {
      expect(filterNavItemsByDay([home], d)).toEqual([home]);
    }
  });

  it('shows a day-gated item only on a matching day', () => {
    expect(filterNavItemsByDay([tvSat], 6)).toEqual([tvSat]); // Saturday
    expect(filterNavItemsByDay([tvSat], 0)).toEqual([]);      // Sunday
    expect(filterNavItemsByDay([tvSat], 3)).toEqual([]);      // Wednesday
  });

  it('supports multi-day lists', () => {
    expect(filterNavItemsByDay([weekdays], 1)).toEqual([weekdays]); // Monday
    expect(filterNavItemsByDay([weekdays], 5)).toEqual([weekdays]); // Friday
    expect(filterNavItemsByDay([weekdays], 6)).toEqual([]);         // Saturday
    expect(filterNavItemsByDay([weekdays], 0)).toEqual([]);         // Sunday
  });

  it('mixes gated and ungated items, preserving order', () => {
    expect(filterNavItemsByDay([home, tvSat, weekdays], 6)).toEqual([home, tvSat]);
    expect(filterNavItemsByDay([home, tvSat, weekdays], 2)).toEqual([home, weekdays]);
  });

  it('treats an empty `days` array as always-show (forgiving default)', () => {
    const item = { ...home, days: [] };
    expect(filterNavItemsByDay([item], 0)).toEqual([item]);
  });

  it('treats a non-array `days` value as always-show', () => {
    const item = { ...home, days: 6 };
    expect(filterNavItemsByDay([item], 0)).toEqual([item]);
  });

  it('returns [] for non-array input', () => {
    expect(filterNavItemsByDay(null, 3)).toEqual([]);
    expect(filterNavItemsByDay(undefined, 3)).toEqual([]);
  });

  it('defaults `today` to the current day-of-week when omitted', () => {
    const today = new Date().getDay();
    const onlyToday = { ...home, days: [today] };
    const notToday = { ...home, days: [(today + 1) % 7] };
    expect(filterNavItemsByDay([onlyToday, notToday])).toEqual([onlyToday]);
  });
});
