import { describe, it, expect } from 'vitest';
import {
  providerIdFor, streamingOffers, chooseProvider, isFresh, lookupIdFor,
  externalIdsFromGuids, hasQuotaRoom, tierOf,
} from './provenance.mjs';

describe('providerIdFor', () => {
  it('maps service spellings to provider ids', () => {
    expect(providerIdFor('Prime Video')).toBe('prime-video');
    expect(providerIdFor('Disney+')).toBe('disney-plus');
    expect(providerIdFor('Paramount Plus')).toBe('paramount-plus');
    expect(providerIdFor('Tubi TV')).toBe('tubi');
    expect(providerIdFor('Max')).toBe('hbo-max');
    expect(providerIdFor('The Roku Channel')).toBe('roku-channel');
    expect(providerIdFor('Apple TV+')).toBe('apple-tv');
  });
  it('counts a channel as the app it is watched in', () => {
    expect(providerIdFor('Paramount+ (Via Amazon Prime)')).toBe('prime-video');
    expect(providerIdFor('AMC+ Amazon Channel')).toBe('prime-video');
    expect(providerIdFor('MAX (Via Amazon Prime)')).toBe('prime-video');
    expect(providerIdFor('HBO (Via Hulu)')).toBe('hulu');
    expect(providerIdFor('Paramount+ Roku Channel')).toBe('roku-channel');
    expect(providerIdFor('AMC+ Roku Premium Channel')).toBe('roku-channel');
    expect(providerIdFor('AMC Plus Apple TV Channel')).toBe('apple-tv');
  });
  it('does not treat Apple\'s store as the Apple TV service', () => {
    expect(providerIdFor('AppleTV')).toBeNull();
  });
  it('falls back to the name slug for services without an alias', () => {
    expect(providerIdFor('Fawesome')).toBe('fawesome');
    expect(providerIdFor('AMC+')).toBe('amc-plus');
    expect(providerIdFor('DirecTV On Demand')).toBe('directv');
    expect(providerIdFor('Philo')).toBe('philo');
    expect(providerIdFor('')).toBeNull();
  });
});

describe('streamingOffers', () => {
  const sources = [
    { name: 'Fawesome', type: 'free' },
    { name: 'Hoopla', type: 'free', url: 'https://hoopla/x' },
    { name: 'Amazon', type: 'rent' },
    { name: 'AppleTV', type: 'buy' },
    { name: 'Hoopla', type: 'free' },
    { name: 'Peacock Premium', type: 'sub' },
    { name: 'Peacock', type: 'free' },
  ];
  it('keeps streaming offers only, one per provider, free over sub', () => {
    const offers = streamingOffers(sources);
    expect(offers.map((o) => [o.provider, o.type])).toEqual([
      ['fawesome', 'free'], ['hoopla', 'free'], ['peacock', 'free'],
    ]);
    expect(offers[1].url).toBe('https://hoopla/x');
  });
  it('tolerates junk', () => {
    expect(streamingOffers(null)).toEqual([]);
    expect(streamingOffers([null, {}])).toEqual([]);
  });
});

describe('chooseProvider', () => {
  const tiers = { free: ['tubi', 'hoopla'], subscribed: ['prime-video', 'peacock'] };
  const offer = (provider, type = 'sub') => ({ provider, type, name: provider });

  it('prefers free services, then subscriptions, then others', () => {
    expect(chooseProvider([offer('netflix'), offer('peacock'), offer('hoopla', 'free')], tiers).provider).toBe('hoopla');
    expect(chooseProvider([offer('netflix'), offer('peacock')], tiers)).toMatchObject({ provider: 'peacock', tier: 'subscribed', name: 'Peacock' });
    expect(chooseProvider([offer('netflix')], tiers)).toMatchObject({ provider: 'netflix', tier: 'other' });
  });
  it('honours configured order within a tier', () => {
    expect(chooseProvider([offer('hoopla', 'free'), offer('tubi', 'free')], tiers).provider).toBe('tubi');
    expect(chooseProvider([offer('peacock'), offer('prime-video')], tiers).provider).toBe('prime-video');
  });
  it('skips offers with no provider and ones that cannot be shown', () => {
    expect(chooseProvider([{ provider: null, type: 'free' }], tiers)).toBeNull();
    expect(chooseProvider([offer('netflix'), offer('hulu')], tiers, (p) => p !== 'netflix').provider).toBe('hulu');
  });
  it('derives the provider from the name for records stored without one', () => {
    const stored = [{ provider: null, name: 'Philo', type: 'sub' }, { provider: null, name: 'AMC+', type: 'sub' }];
    expect(chooseProvider(stored, tiers, (p) => p === 'amc-plus')).toMatchObject({ provider: 'amc-plus', name: 'AMC+', tier: 'other' });
  });
  it('returns null when nothing qualifies', () => {
    expect(chooseProvider([], tiers)).toBeNull();
    expect(chooseProvider(undefined, tiers)).toBeNull();
  });
  it('tierOf defaults to other', () => {
    expect(tierOf('netflix', tiers)).toBe('other');
    expect(tierOf('netflix')).toBe('other');
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
