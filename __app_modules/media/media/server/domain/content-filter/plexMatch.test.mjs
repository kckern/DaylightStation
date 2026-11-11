import { describe, it, expect } from 'vitest';
import { normTitle, planMap, filmMatch, reasonText, diffPlan, YEAR_TOLERANCE, RUNTIME_WARN_SEC } from './plexMatch.mjs';

const plex = (ratingKey, title, year, runtimeSec = 6000) => ({ ratingKey: String(ratingKey), title, year, runtimeSec });
const work = (workId, title, year, edlKeys = [], extra = {}) => ({ workId, slug: `s-${workId}`, type: 'movie', tagCount: 50, title, year, runtimeSec: 6000, edlKeys: edlKeys.map(String), ...extra });

describe('normTitle', () => {
  it('ignores case, articles, punctuation and &', () => {
    expect(normTitle('The Godfather: Part II')).toBe(normTitle('Godfather Part II'));
    expect(normTitle('Cowboys & Aliens')).toBe(normTitle('cowboys and aliens'));
    expect(normTitle('*batteries not included')).toBe('batteries not included');
  });
});

describe('planMap: title AND year (±1) must agree', () => {
  it('constants', () => { expect(YEAR_TOLERANCE).toBe(1); expect(RUNTIME_WARN_SEC).toBe(300); });

  it('maps a work to the one Plex film with its title and year, storing Plex year and runtime', () => {
    const p = planMap({ works: [work(1, 'Gladiator', 2000, ['10'])], plexMovies: [plex(10, 'Gladiator', 2000, 9300), plex(11, 'Gladiator', 1992)] });
    expect(p.map['plex:10']).toMatchObject({ title: 'Gladiator', plexType: 'movie', year: 2000, runtimeSec: 9300, vidangel: { id: 1, slug: 's-1', year: 2000, runtimeSec: 6000 } });
    expect(Object.keys(p.map)).toEqual(['plex:10']);
    expect(p.rekeys).toEqual([]);
  });

  it('a year one off still matches; two off does not', () => {
    expect(planMap({ works: [work(1, 'Conclave', 2024, ['5'])], plexMovies: [plex(5, 'Conclave', 2023)] }).map['plex:5']).toBeTruthy();
    const p = planMap({ works: [work(1, 'Casino Royale', 2006, ['5'])], plexMovies: [plex(5, 'Casino Royale', 1954)] });
    expect(p.map).toEqual({});
    expect(p.unmatched['plex:5']).toMatchObject({ reason: 'year-mismatch', plexYears: [1954], year: 2006 });
  });

  it('never maps one work onto several Plex films: one shared title, many years', () => {
    const plexMovies = [1914, 1947, 1950, 1997].map((y, i) => plex(100 + i, 'Cinderella', y));
    const p = planMap({ works: [work(7, 'Cinderella', 2021, ['100', '101', '102', '103'])], plexMovies });
    expect(p.map).toEqual({});
    expect(Object.keys(p.unmatched)).toEqual(['plex:100']);
    expect(p.unmatched['plex:100']).toMatchObject({ reason: 'year-mismatch', plexYears: [1914, 1947, 1950, 1997] });
    expect(p.duplicates.map((d) => d.ratingKey)).toEqual(['101', '102', '103']);
  });

  it('several Plex films within the year window are ambiguous, never guessed', () => {
    const p = planMap({ works: [work(1, 'Shaft', 2000, ['1'])], plexMovies: [plex(1, 'Shaft', 2000), plex(2, 'Shaft', 2001)] });
    expect(p.map).toEqual({});
    expect(p.unmatched['plex:1']).toMatchObject({ reason: 'ambiguous', plexKeys: ['1', '2'] });
  });

  it('one Plex film claimed by two works is contested for both', () => {
    const p = planMap({ works: [work(1, 'Hot Rod', 2007, ['1']), work(2, 'Hot Rod', 2008, ['2'])], plexMovies: [plex(1, 'Hot Rod', 2007)] });
    expect(p.map).toEqual({});
    expect(p.unmatched['plex:1'].reason).toBe('contested');
    expect(p.unmatched['plex:2'].reason).toBe('contested');
  });

  it('no Plex film with the title, and an unknown year, are unmatched with their reason', () => {
    const p = planMap({ works: [work(1, 'The Lost City', 2022, ['9']), work(2, 'Annie', null, ['8'])], plexMovies: [plex(3, 'Annie', 1982)] });
    expect(p.unmatched['plex:9'].reason).toBe('not-in-plex');
    expect(p.unmatched['plex:8'].reason).toBe('year-unknown');
  });

  it('a work with no EDL that matches is mapped; one that does not is left out (not a library film)', () => {
    const p = planMap({ works: [work(1, 'Vivo', 2021), work(2, 'Nope', 2020)], plexMovies: [plex(4, 'Vivo', 2021)] });
    expect(Object.keys(p.map)).toEqual(['plex:4']);
    expect(p.unmatched).toEqual({});
  });

  it('re-keys a stale EDL key to the live Plex film with the right title and year', () => {
    const p = planMap({ works: [work(1, '12 Strong', 2018, ['658287'])], plexMovies: [plex(702772, '12 Strong', 2018)] });
    expect(p.map['plex:702772']).toBeTruthy();
    expect(p.rekeys).toEqual([{ workId: 1, title: '12 Strong', from: '658287', to: '702772' }]);
  });

  it('keeps the key that already holds the film; the other EDL keys are duplicates, not re-keyed', () => {
    const p = planMap({ works: [work(1, 'Godzilla', 1998, ['54656', '54657', '666760'])], plexMovies: [plex(54656, 'Godzilla', 1998), plex(54657, 'Godzilla', 2014), plex(666760, 'Godzilla', 1954)] });
    expect(Object.keys(p.map)).toEqual(['plex:54656']);
    expect(p.rekeys).toEqual([]);
    expect(p.duplicates.map((d) => [d.ratingKey, d.of])).toEqual([['54657', '54656'], ['666760', '54656']]);
  });

  it('never re-keys away from household data; reports it blocked', () => {
    const p = planMap({ works: [work(1, 'Matilda', 1996, ['5'])], plexMovies: [plex(6, 'Matilda', 1996)], householdKeys: new Set(['5']) });
    expect(p.rekeys).toEqual([]);
    expect(p.blocked).toEqual([{ workId: 1, title: 'Matilda', from: '5', to: '6', why: 'household data at the old key' }]);
    expect(p.map['plex:6']).toBeTruthy();
  });

  it('never re-keys onto a key holding another film\'s EDL', () => {
    const p = planMap({ works: [work(1, 'Robin Hood', 2010, ['50']), work(2, 'Other', 1999, ['60'])], plexMovies: [plex(60, 'Robin Hood', 2010)] });
    expect(p.rekeys).toEqual([]);
    expect(p.blocked[0]).toMatchObject({ from: '50', to: '60', why: 'another film\'s EDL holds the new key' });
  });

  it('is idempotent: planning on its own output changes nothing', () => {
    const plexMovies = [plex(702772, '12 Strong', 2018), plex(54656, 'Godzilla', 1998)];
    const first = planMap({ works: [work(1, '12 Strong', 2018, ['658287']), work(2, 'Godzilla', 1998, ['54656'])], plexMovies });
    const second = planMap({ works: [work(1, '12 Strong', 2018, ['702772']), work(2, 'Godzilla', 1998, ['54656'])], plexMovies });
    expect(second.rekeys).toEqual([]);
    expect(second.map).toEqual(first.map);
  });

  it('matches on any of a work\'s titles (catalog and EDL spellings)', () => {
    const p = planMap({ works: [work(1, 'STILL: A Michael J. Fox Movie', 2023, [], { titles: ['Still A Michael J Fox Movie'] })], plexMovies: [plex(3, 'Still: A Michael J. Fox Movie', 2023)] });
    expect(p.map['plex:3']).toBeTruthy();
  });
});

describe('diffPlan', () => {
  it('reports kept, re-keyed, newly mapped and dropped movie entries', () => {
    const before = { map: { 'plex:1': { plexType: 'movie', title: 'A' }, 'plex:2': { plexType: 'movie', title: 'B' }, 'plex:9': { plexType: 'show', title: 'S' } } };
    const plan = { map: { 'plex:1': { title: 'A' }, 'plex:3': { title: 'B' }, 'plex:4': { title: 'C' } }, unmatched: {}, rekeys: [{ from: '2', to: '3', title: 'B' }] };
    const d = diffPlan(before, plan);
    expect(d.kept).toEqual(['1']);
    expect(d.rekeyed).toEqual([{ from: '2', to: '3', title: 'B' }]);
    expect(d.added).toEqual(['4']);
    expect(d.dropped).toEqual([]);
  });
});

describe('filmMatch (the library)', () => {
  const item = (year, runtimeSec = 6000) => ({ title: 'X', year, runtimeSec });
  it('verified when the live Plex film is within a year of the EDL', () => {
    expect(filmMatch({ edl: { year: 2000, runtimeSec: 6000 }, live: true, plexItem: item(2001) })).toEqual({ match: 'verified', unmatched: null, runtimeWarning: null });
  });
  it('a runtime off by more than 5 minutes is still verified, with a warning', () => {
    const m = filmMatch({ edl: { year: 2000, runtimeSec: 124 * 60 }, live: true, plexItem: item(2000, 162 * 60) });
    expect(m.match).toBe('verified');
    expect(m.runtimeWarning).toEqual({ edlMin: 124, plexMin: 162 });
    expect(filmMatch({ edl: { year: 2000, runtimeSec: 6000 }, live: true, plexItem: item(2000, 6290) }).runtimeWarning).toBeNull();
  });
  it('a stale key is unmatched: no Plex film', () => {
    expect(filmMatch({ edl: { year: 2000 }, live: true, plexItem: null }).unmatched).toEqual({ reason: 'not-in-plex', text: 'no Plex film' });
  });
  it('a live key holding another year is unmatched, naming the Plex year', () => {
    expect(filmMatch({ edl: { year: 2006 }, live: true, plexItem: item(1954) }).unmatched).toEqual({ reason: 'year-mismatch', text: 'Plex has the 1954 film' });
  });
  it('the index\'s own unmatched reason wins (several Plex films)', () => {
    expect(filmMatch({ edl: { year: 2000 }, live: true, plexItem: item(2000), indexEntry: { kind: 'unmatched', reason: 'ambiguous' } }).unmatched.text).toBe('several Plex films');
  });
  it('a key whose film another entry holds is unmatched as a duplicate', () => {
    expect(filmMatch({ edl: { year: 1985 }, live: true, plexItem: null, duplicateOf: '7' }).unmatched).toEqual({ reason: 'duplicate', text: 'another entry has this film' });
  });
  it('Plex unreachable: the year stored in the index decides; with none the film stays verified', () => {
    expect(filmMatch({ edl: { year: 2006 }, live: false, plexItem: null, indexEntry: { kind: 'map', year: 1954 } }).match).toBe('unmatched');
    expect(filmMatch({ edl: { year: 2006 }, live: false, plexItem: null, indexEntry: { kind: 'map' } }).match).toBe('verified');
  });
  it('an EDL without a year (override-only film) is verified when Plex has the key', () => {
    expect(filmMatch({ edl: null, live: true, plexItem: item(2000) }).match).toBe('verified');
  });
});

describe('reasonText', () => {
  it('names the Plex years', () => {
    expect(reasonText('year-mismatch', { plexYears: [1930] })).toBe('Plex has the 1930 film');
    expect(reasonText('year-mismatch', { plexYears: [1914, 1950, 1997] })).toBe('Plex has the 1914, 1950 and 1997 films');
    expect(reasonText('ambiguous')).toBe('several Plex films');
    expect(reasonText('contested')).toBe('several VidAngel films claim one Plex film');
    expect(reasonText('year-unknown')).toBe('VidAngel year unknown');
  });
});
