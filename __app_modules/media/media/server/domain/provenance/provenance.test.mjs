import { describe, it, expect } from 'vitest';
import {
  providerIdFor, providerLabel, parseServices, streamingOffers, isFresh, lookupIdFor,
  externalIdsFromGuids, hasQuotaRoom,
} from './provenance.mjs';

// A service map as the household config spells it (the `services` section).
const SERVICES = parseServices([
  { provider: 'none', names: ['AppleTV'] },
  { provider: 'freevee', label: 'Freevee', names: ['Amazon Freevee', 'Freevee'] },
  { provider: 'prime-video', label: 'Prime Video', match: '\\bamazon\\b|\\bprime video\\b' },
  { provider: 'hulu', label: 'Hulu', match: '\\bhulu\\b' },
  { provider: 'roku-channel', label: 'The Roku Channel', match: '\\broku\\b' },
  { provider: 'peacock', label: 'Peacock', names: ['Peacock', 'Peacock Premium'] },
  { provider: 'tubi', label: 'Tubi', names: ['Tubi TV', 'Tubi'] },
  { provider: 'hbo-max', label: 'HBO Max', names: ['Max', 'HBO Max'] },
]);

describe('parseServices', () => {
  it('reads labels and skips entries without a provider', () => {
    const map = parseServices([{ names: ['X'] }, null, { provider: 'tubi', label: 'Tubi' }]);
    expect(map.entries).toHaveLength(1);
    expect(map.labels).toEqual({ tubi: 'Tubi' });
    expect(map.invalid).toEqual([]);
  });
  it('reports a match that does not compile, and keeps the entry for its names', () => {
    const map = parseServices([{ provider: 'tubi', names: ['Tubi TV'], match: '(' }]);
    expect(map.invalid).toEqual([{ provider: 'tubi', match: '(' }]);
    expect(providerIdFor('Tubi TV', map)).toBe('tubi');
  });
  it('is empty for no config', () => {
    expect(parseServices(undefined).entries).toEqual([]);
  });
  it('reads accents, ignoring ones that are not colours', () => {
    const map = parseServices([{ provider: 'a', accent: '#e50914' }, { provider: 'b', accent: 'red' }]);
    expect(map.accents).toEqual({ a: '#e50914' });
  });
});

describe('providerIdFor', () => {
  it('maps names by the service map, first entry wins', () => {
    expect(providerIdFor('Tubi TV', SERVICES)).toBe('tubi');
    expect(providerIdFor('Max', SERVICES)).toBe('hbo-max');
    expect(providerIdFor('Peacock Premium', SERVICES)).toBe('peacock');
    expect(providerIdFor('Amazon Freevee', SERVICES)).toBe('freevee'); // above the Amazon pattern
    expect(providerIdFor('Paramount+ (Via Amazon Prime)', SERVICES)).toBe('prime-video');
    expect(providerIdFor('Prime Video Free', SERVICES)).toBe('prime-video');
    expect(providerIdFor('HBO (Via Hulu)', SERVICES)).toBe('hulu');
    expect(providerIdFor('Paramount+ Roku Channel', SERVICES)).toBe('roku-channel');
  });
  it('drops a name mapped to none', () => {
    expect(providerIdFor('AppleTV', SERVICES)).toBeNull();
  });
  it('falls back to the name slug', () => {
    expect(providerIdFor('Fawesome', SERVICES)).toBe('fawesome');
    expect(providerIdFor('AMC+')).toBe('amc-plus');
    expect(providerIdFor('')).toBeNull();
  });
  it('labels by the map, else the given name, else the id', () => {
    expect(providerLabel('prime-video', SERVICES, 'Paramount+ (Via Amazon Prime)')).toBe('Prime Video');
    expect(providerLabel('fawesome', SERVICES, 'Fawesome')).toBe('Fawesome');
    expect(providerLabel('fawesome', SERVICES)).toBe('fawesome');
  });
});

describe('streamingOffers', () => {
  const sources = [
    { name: 'Fawesome', type: 'free' },
    { name: 'Hoopla', type: 'free', url: 'https://hoopla/x' },
    { name: 'Amazon', type: 'rent' },
    { name: 'AppleTV', type: 'sub' },
    { name: 'Hoopla', type: 'free' },
    { name: 'Peacock Premium', type: 'sub' },
    { name: 'Peacock', type: 'free' },
  ];
  it('keeps streaming offers only, one per provider, free over sub', () => {
    const offers = streamingOffers(sources, SERVICES);
    expect(offers.map((o) => [o.provider, o.type])).toEqual([
      ['fawesome', 'free'], ['hoopla', 'free'], [null, 'sub'], ['peacock', 'free'],
    ]);
    expect(offers[1].url).toBe('https://hoopla/x');
  });
  it('tolerates junk', () => {
    expect(streamingOffers(null, SERVICES)).toEqual([]);
    expect(streamingOffers([null, {}], SERVICES)).toEqual([]);
  });
});

describe('isFresh', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  it('is fresh inside the window', () => {
    expect(isFresh({ checkedAt: '2026-11-01T00:00:00Z' }, now, 30)).toBe(true);
    expect(isFresh({ checkedAt: '2026-10-01T00:00:00Z' }, now, 30)).toBe(false);
  });
  it('treats a missing date as stale', () => {
    expect(isFresh({}, now, 30)).toBe(false);
    expect(isFresh(null, now, 30)).toBe(false);
  });
});

describe('lookupIdFor / externalIdsFromGuids', () => {
  it('prefers IMDb, falls back to typed TMDB', () => {
    expect(lookupIdFor({ kind: 'movie', imdb: 'tt0065126', tmdb: '17529' })).toBe('tt0065126');
    expect(lookupIdFor({ kind: 'movie', tmdb: '17529' })).toBe('movie-17529');
    expect(lookupIdFor({ kind: 'show', tmdb: 1396 })).toBe('tv-1396');
    expect(lookupIdFor({ kind: 'movie' })).toBeNull();
  });
  it('reads Plex guids', () => {
    expect(externalIdsFromGuids([{ id: 'imdb://tt0065126' }, { id: 'tmdb://17529' }, { id: 'tvdb://6889' }]))
      .toEqual({ imdb: 'tt0065126', tmdb: '17529' });
    expect(externalIdsFromGuids(undefined)).toEqual({ imdb: null, tmdb: null });
  });
});

describe('hasQuotaRoom', () => {
  it('keeps a reserve back within the month', () => {
    expect(hasQuotaRoom({ month: '2026-11', quota: 2500, quotaUsed: 2399 }, { month: '2026-11', reserve: 100 })).toBe(true);
    expect(hasQuotaRoom({ month: '2026-11', quota: 2500, quotaUsed: 2400 }, { month: '2026-11', reserve: 100 })).toBe(false);
  });
  it('treats a new month or unknown usage as room', () => {
    expect(hasQuotaRoom({ month: '2026-10', quota: 2500, quotaUsed: 2500 }, { month: '2026-11' })).toBe(true);
    expect(hasQuotaRoom(null, { month: '2026-11' })).toBe(true);
  });
});
