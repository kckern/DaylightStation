import { describe, it, expect } from 'vitest';
import {
  tileKind, aspectFor, parseDateTitle, shortDate, presentTitle, normalizeTitle,
  collapseEditions, editionsLabel, progressPercent,
} from './tilePresentation.js';

describe('tileKind / aspectFor — art first, aspect by kind', () => {
  it.each([
    ['episode', 'wide', '16 / 9'], ['video', 'wide', '16 / 9'], ['clip', 'wide', '16 / 9'],
    ['movie', 'poster', '2 / 3'], ['book', 'poster', '2 / 3'], ['audiobook', 'poster', '2 / 3'],
    ['album', 'square', '1 / 1'], ['playlist', 'square', '1 / 1'], ['track', 'square', '1 / 1'],
  ])('%s is %s (%s)', (type, kind, aspect) => {
    expect(tileKind({ type })).toBe(kind);
    expect(aspectFor(kind)).toBe(aspect);
  });
  it('falls back to 16:9 for an unknown or missing type', () => {
    expect(tileKind({ type: 'mystery' })).toBe('wide');
    expect(tileKind({})).toBe('wide');
    expect(tileKind(null)).toBe('wide');
    expect(aspectFor('wide')).toBe('16 / 9');
  });
});

describe('date-named items', () => {
  const now = new Date(2026, 9, 6);
  it('parses compact and ISO-ish dates, nothing else', () => {
    expect(parseDateTitle('20261005')).toEqual(new Date(2026, 9, 5));
    expect(parseDateTitle('2026-10-05')).toEqual(new Date(2026, 9, 5));
    expect(parseDateTitle('2026-10-05T07:30:00Z')).toEqual(new Date(2026, 9, 5));
    expect(parseDateTitle('2026.10.05')).toEqual(new Date(2026, 9, 5));
    expect(parseDateTitle('20261340')).toBeNull(); // not a date
    expect(parseDateTitle('12345678')).toBeNull();
    expect(parseDateTitle('Persuasion')).toBeNull();
    expect(parseDateTitle('Lesson 22')).toBeNull();
    expect(parseDateTitle(null)).toBeNull();
  });
  it('short date drops the year only for the current year', () => {
    expect(shortDate(new Date(2026, 9, 5), { locale: 'en-US', now })).toBe('Oct 5');
    expect(shortDate(new Date(2025, 9, 5), { locale: 'en-US', now })).toBe('Oct 5, 2025');
  });
  it('reads "<source> · <short date>", never the bare date string', () => {
    expect(presentTitle({ title: '20261005', parentTitle: 'Aljazeera' }, { locale: 'en-US', now })).toBe('Aljazeera · Oct 5');
    expect(presentTitle({ title: '2026-10-05', parentTitle: 'Season 1', grandparentTitle: 'Evening News' }, { locale: 'en-US', now }))
      .toBe('Evening News · Oct 5');
    expect(presentTitle({ title: '20261005' }, { locale: 'en-US', now })).toBe('Oct 5');
    expect(presentTitle({ title: '20261005', parentTitle: 'Aljazeera' }, { locale: 'en-US', now })).not.toMatch(/20261005/);
  });
  it('leaves ordinary titles alone', () => {
    expect(presentTitle({ title: 'Horsey Ride', parentTitle: 'Season 1' })).toBe('Horsey Ride');
    expect(presentTitle({ title: null })).toBeNull();
  });
});

describe('edition collapse', () => {
  const book = (id, title = 'Persuasion', type = 'album') => ({ contentId: id, title, type });
  it('collapses same title + type to one tile that carries every edition', () => {
    const rows = [book('plex:1', 'The Confessions'), book('plex:2'), book('plex:3'), book('plex:4', 'persuasion!'), book('plex:5')];
    const groups = collapseEditions(rows);
    expect(groups.map(g => g.entry.contentId)).toEqual(['plex:1', 'plex:2']);
    expect(groups[1].editions.map(e => e.contentId)).toEqual(['plex:2', 'plex:3', 'plex:4', 'plex:5']);
    expect(editionsLabel(groups[1].editions.length)).toBe('4 editions');
    expect(editionsLabel(groups[0].editions.length)).toBeNull();
  });
  it('never merges episodes, videos or tracks that share a name across shows', () => {
    const ep = (id, show) => ({ contentId: id, title: 'Pilot', type: 'episode', grandparentTitle: show });
    expect(collapseEditions([ep('plex:1', 'Show A'), ep('plex:2', 'Show B')])).toHaveLength(2);
    expect(collapseEditions([ep('plex:1', 'Show A'), ep('plex:2', 'Show A')])).toHaveLength(2);
    expect(collapseEditions([book('plex:1', 'Intro', 'video'), book('plex:2', 'Intro', 'video')])).toHaveLength(2);
    expect(collapseEditions([book('plex:1', 'Intro', 'track'), book('plex:2', 'Intro', 'track')])).toHaveLength(2);
  });
  it('keeps same-titled films of different years, and albums of different artists, apart', () => {
    expect(collapseEditions([{ contentId: 'a', title: 'Dune', type: 'movie', year: 1984 }, { contentId: 'b', title: 'Dune', type: 'movie', year: 2021 }])).toHaveLength(2);
    expect(collapseEditions([{ contentId: 'a', title: 'Greatest Hits', type: 'album', parentTitle: 'Queen' }, { contentId: 'b', title: 'Greatest Hits', type: 'album', parentTitle: 'ABBA' }])).toHaveLength(2);
    expect(collapseEditions([{ contentId: 'a', title: 'Greatest Hits', type: 'album', parentTitle: 'Queen' }, { contentId: 'b', title: 'Greatest Hits', type: 'album', parentTitle: 'Queen' }])).toHaveLength(1);
  });
  it('never collapses when told not to (Carry on)', () => {
    expect(collapseEditions([book('plex:1'), book('plex:2')], { collapse: false })).toHaveLength(2);
  });
  it('keeps same-title items of a different type apart', () => {
    const groups = collapseEditions([book('plex:1', 'Dune', 'movie'), book('plex:2', 'Dune', 'audiobook')]);
    expect(groups).toHaveLength(2);
  });
  it('never merges untitled items, and drops the very same item listed twice', () => {
    expect(collapseEditions([{ contentId: 'a' }, { contentId: 'b' }])).toHaveLength(2);
    expect(collapseEditions([book('plex:1'), book('plex:1')])).toHaveLength(1);
  });
  it('accepts a getter for wrapped rows and tolerates junk', () => {
    const groups = collapseEditions([{ raw: book('plex:1') }, null, { raw: book('plex:2') }], { get: e => e?.raw, idOf: e => e?.raw?.contentId });
    expect(groups).toHaveLength(1);
    expect(groups[0].editions).toHaveLength(2);
    expect(collapseEditions(undefined)).toEqual([]);
  });
  it('normalizes accents, case and punctuation', () => {
    expect(normalizeTitle('Les Misérables!')).toBe('les miserables');
    expect(normalizeTitle('Tom & Jerry')).toBe('tom and jerry');
  });
});

describe('progressPercent', () => {
  it('draws a bar only for an unfinished item with real progress', () => {
    expect(progressPercent(45)).toBe(45);
    expect(progressPercent(0)).toBeNull();
    expect(progressPercent(100)).toBeNull();
    expect(progressPercent(45, true)).toBeNull();
    expect(progressPercent(undefined)).toBeNull();
  });
});
