import { describe, it, expect } from 'vitest';
import { timeOfDayGroups, assembleSuggestions, SUGGESTION_DEFAULTS } from './mediaSuggestions.mjs';

const row = (day, time, contentId, extra = {}) => ({
  deviceId: 'fleet:livingroom-tv', localTime: `2026-10-${String(day).padStart(2, '0')} ${time}`, contentId, ...extra,
});
const ep = (id, show, title = id) => ({ kind: 'episode', parentId: `${show}-s1`, grandparentId: show, title });

describe('timeOfDayGroups', () => {
  const now = '2026-10-03 07:30:00';

  it('ranks by distinct days within ±90 min of now, collapses episodes to the show, with the newest as "continue"', () => {
    const rows = [
      row(2, '07:25:00', 'plex:e3', ep('plex:e3', 'plex:bluey', 'S1E3')),
      row(2, '07:20:00', 'plex:e2', ep('plex:e2', 'plex:bluey', 'S1E2')),
      row(1, '08:50:00', 'plex:e1', ep('plex:e1', 'plex:bluey')),
      row(30, '06:10:00', 'plex:e0', ep('plex:e0', 'plex:bluey')), // Sep 30, 80 min before
      row(1, '07:00:00', 'plex:news', { kind: 'clip' }),
      row(2, '07:00:00', 'plex:news', { kind: 'clip' }),
      row(3, '07:00:00', 'plex:news', { kind: 'clip' }),
      row(3, '07:01:00', 'plex:news', { kind: 'clip' }), // same day twice: still 3 days
      row(1, '12:00:00', 'plex:lunch', { kind: 'movie' }), // outside the window
    ].map((r) => (r.localTime.startsWith('2026-10-30') ? { ...r, localTime: r.localTime.replace('2026-10-30', '2026-09-30') } : r));
    const groups = timeOfDayGroups(rows, { now });
    // Equal days: the more recently played group first.
    expect(groups.map((g) => [g.id, g.kind, g.days])).toEqual([
      ['plex:news', 'item', 3],
      ['plex:bluey', 'collection', 3],
    ]);
    expect(groups[1]).toMatchObject({ type: 'show', continue: { contentId: 'plex:e3', title: 'S1E3' } });
  });

  it('more distinct days outranks more plays', () => {
    const rows = [
      ...[1, 2, 3, 4].map((d) => row(d, '07:00:00', 'plex:daily', { kind: 'movie' })),
      ...[1, 1, 1, 2, 2, 2, 3].map((d, i) => row(d, `07:1${i}:00`, 'plex:binge', { kind: 'movie' })),
    ].map((r) => (r.localTime.startsWith('2026-10-04') ? { ...r, localTime: '2026-09-29 07:00:00' } : r));
    expect(timeOfDayGroups(rows, { now: '2026-10-03 07:30:00' }).map((g) => [g.id, g.days])).toEqual([['plex:daily', 4], ['plex:binge', 3]]);
  });

  it('needs at least 3 distinct days; play count alone is not enough', () => {
    const rows = [1, 2, 3, 4, 5].map((m) => row(2, `07:0${m}:00`, 'plex:x', { kind: 'movie' }));
    expect(timeOfDayGroups(rows, { now })).toEqual([]);
  });

  it('wraps midnight and ignores rows older than 30 days', () => {
    const late = '2026-10-03 23:50:00';
    const rows = [
      row(1, '00:30:00', 'plex:sleep', { kind: 'track', parentId: 'plex:album' }),
      row(2, '00:10:00', 'plex:sleep2', { kind: 'track', parentId: 'plex:album' }),
      row(3, '23:30:00', 'plex:sleep', { kind: 'track', parentId: 'plex:album' }),
      { ...row(1, '23:40:00', 'plex:old', { kind: 'movie' }), localTime: '2026-08-20 23:40:00' },
      { ...row(1, '23:40:00', 'plex:old', { kind: 'movie' }), localTime: '2026-08-21 23:40:00' },
      { ...row(1, '23:40:00', 'plex:old', { kind: 'movie' }), localTime: '2026-08-22 23:40:00' },
    ];
    expect(timeOfDayGroups(rows, { now: late }).map((g) => [g.id, g.type, g.days])).toEqual([['plex:album', 'album', 3]]);
  });
});

describe('assembleSuggestions', () => {
  const fav = (id, extra = {}) => ({ id, kind: 'collection', title: id, ...extra });
  const carry = (id, extra = {}) => ({ id, kind: 'item', title: id, ...extra });

  it('orders rows favourites → carry on → time of day → new, hides empty rows', () => {
    const { rows, empty } = assembleSuggestions({
      favourites: [fav('plex:a')], carryOn: [], timeOfDay: [carry('plex:t')], fresh: [carry('plex:n')], timeOfDayLabel: 'Usually here at this time',
    });
    expect(empty).toBe(false);
    expect(rows.map((r) => [r.id, r.title, r.items.map((i) => i.id)])).toEqual([
      ['favourites', 'Favourites', ['plex:a']],
      ['time-of-day', 'Usually here at this time', ['plex:t']],
      ['new', 'New', ['plex:n']],
    ]);
  });

  it('dedupes with precedence favourites > carry on > time of day > new, matching collections; the favourite keeps a "continue"', () => {
    const { rows } = assembleSuggestions({
      favourites: [fav('plex:bluey')],
      carryOn: [carry('plex:e7', { title: 'S2E7', parentId: 'plex:s2', grandparentId: 'plex:bluey' }), carry('plex:film')],
      timeOfDay: [carry('plex:bluey', { kind: 'collection' }), carry('plex:film'), carry('plex:radio')],
      fresh: [carry('plex:radio'), carry('plex:new')],
    });
    expect(rows.map((r) => [r.id, r.items.map((i) => i.id)])).toEqual([
      ['favourites', ['plex:bluey']],
      ['carry-on', ['plex:film']],
      ['time-of-day', ['plex:radio']],
      ['new', ['plex:new']],
    ]);
    expect(rows[0].items[0].continue).toEqual({ contentId: 'plex:e7', title: 'S2E7' });
  });

  it('two carry-on episodes of one show: the second is dropped, and an item never gains a "continue"', () => {
    const { rows } = assembleSuggestions({
      carryOn: [carry('plex:bingo', { grandparentId: 'plex:bluey' }), carry('plex:calypso', { grandparentId: 'plex:bluey' })],
    });
    expect(rows[0].items).toEqual([carry('plex:bingo', { grandparentId: 'plex:bluey' })]);
  });

  it('never suggests what is playing anywhere or was removed; caps 6 per row and 20 in all', () => {
    const many = (prefix, n) => Array.from({ length: n }, (_, i) => carry(`plex:${prefix}${i}`));
    const { rows } = assembleSuggestions({
      favourites: many('f', 9), carryOn: many('c', 9), timeOfDay: many('t', 9), fresh: many('n', 9),
      exclude: new Set(['plex:f0', 'plex:c1']),
    });
    expect(rows.map((r) => r.items.length)).toEqual([6, 6, 6, 2]);
    expect(rows[0].items.map((i) => i.id)).not.toContain('plex:f0');
    expect(rows[1].items.map((i) => i.id)).not.toContain('plex:c1');
    expect(rows.flatMap((r) => r.items).length).toBe(SUGGESTION_DEFAULTS.maxTotal);
  });

  it('an item whose show is playing is excluded through its parent ids', () => {
    const { rows } = assembleSuggestions({ carryOn: [carry('plex:e8', { grandparentId: 'plex:bluey' })], exclude: new Set(['plex:bluey']) });
    expect(rows).toEqual([]);
  });

  it('everything empty → { rows: [], empty: true }', () => {
    expect(assembleSuggestions({})).toEqual({ rows: [], empty: true });
  });
});
