import { describe, it, expect, vi } from 'vitest';
import { GetTitleProvenance } from './GetTitleProvenance.mjs';

const NOW = new Date('2026-11-20T12:00:00Z');
const silent = { info: () => {}, warn: () => {} };

function fakeStore(records = {}, usage = null) {
  const data = { ...records };
  let u = usage;
  return {
    data,
    get: vi.fn(async (k) => data[k] ?? null),
    put: vi.fn(async (k, r, nu) => { data[k] = r; if (nu) u = nu; }),
    usage: vi.fn(async () => u),
  };
}

function build({ store = fakeStore(), identity, sources = [], quotaUsed = 10, policy = {}, logos = () => true } = {}) {
  const identityReader = { identify: vi.fn(async (rk) => (typeof identity === 'function' ? identity(rk) : identity)) };
  const availability = { sources: vi.fn(async () => ({ sources, quota: 2500, quotaUsed })) };
  const uc = new GetTitleProvenance({
    identityReader, availability, store,
    logos: { has: logos },
    policy: () => ({ enabled: true, tiers: { free: ['tubi', 'hoopla'], subscribed: ['peacock'] }, refreshDays: 30, quotaReserve: 100, ...policy }),
    clock: () => NOW, logger: silent,
  });
  return { uc, identityReader, availability, store };
}

const MOVIE = { key: '100', kind: 'movie', title: 'True Grit', year: 1969, imdb: 'tt0065126', tmdb: '17529' };

describe('GetTitleProvenance', () => {
  it('looks up an unknown title, stores it, and picks by tier', async () => {
    const { uc, availability, store } = build({
      identity: MOVIE,
      sources: [{ name: 'Netflix', type: 'sub' }, { name: 'Hoopla', type: 'free' }, { name: 'Amazon', type: 'rent' }],
    });
    const out = await uc.execute({ ratingKey: '100' });
    expect(out).toMatchObject({ ratingKey: '100', provider: 'hoopla', tier: 'free', name: 'Hoopla' });
    expect(availability.sources).toHaveBeenCalledWith('tt0065126');
    expect(store.data['100'].offers.map((o) => o.provider)).toEqual(['netflix', 'hoopla']);
    expect(store.put.mock.calls[0][2]).toEqual({ month: '2026-11', quota: 2500, quotaUsed: 10 });
  });

  it('serves a fresh record without a lookup', async () => {
    const store = fakeStore({ 100: { key: '100', checkedAt: '2026-11-10T00:00:00Z', offers: [{ provider: 'peacock', type: 'sub' }] } });
    const { uc, availability, identityReader } = build({ store, identity: MOVIE });
    expect((await uc.execute({ ratingKey: '100' })).provider).toBe('peacock');
    expect(availability.sources).not.toHaveBeenCalled();
    expect(identityReader.identify).not.toHaveBeenCalled();
  });

  it('refreshes a stale record', async () => {
    const store = fakeStore({ 100: { key: '100', checkedAt: '2026-09-01T00:00:00Z', offers: [{ provider: 'peacock', type: 'sub' }] } });
    const { uc, availability } = build({ store, identity: MOVIE, sources: [{ name: 'Tubi TV', type: 'free' }] });
    expect((await uc.execute({ ratingKey: '100' })).provider).toBe('tubi');
    expect(availability.sources).toHaveBeenCalledTimes(1);
  });

  it('records an episode under its show', async () => {
    const show = { key: '200', kind: 'show', title: 'Show', imdb: null, tmdb: '1396' };
    const { uc, availability, store } = build({ identity: show, sources: [{ name: 'Peacock', type: 'sub' }] });
    expect((await uc.execute({ ratingKey: '201' })).provider).toBe('peacock');
    expect(availability.sources).toHaveBeenCalledWith('tv-1396');
    expect(Object.keys(store.data)).toEqual(['200']);
  });

  it('returns null when the title is found nowhere, and remembers that', async () => {
    const { uc, store, availability } = build({ identity: MOVIE, sources: [] });
    expect(await uc.execute({ ratingKey: '100' })).toBeNull();
    expect(store.data['100'].offers).toEqual([]);
    expect(await uc.execute({ ratingKey: '100' })).toBeNull();
    expect(availability.sources).toHaveBeenCalledTimes(1);
  });

  it('returns null for a provider with no logo', async () => {
    const { uc } = build({ identity: MOVIE, sources: [{ name: 'Netflix', type: 'sub' }], logos: (p) => p !== 'netflix' });
    expect(await uc.execute({ ratingKey: '100' })).toBeNull();
  });

  it('stores titles without external ids without spending a lookup', async () => {
    const { uc, availability, store } = build({ identity: { key: '100', kind: 'movie', title: 'Home video' } });
    expect(await uc.execute({ ratingKey: '100' })).toBeNull();
    expect(availability.sources).not.toHaveBeenCalled();
    expect(store.data['100'].note).toBe('no external id');
  });

  it('holds back the reserve of the monthly allowance', async () => {
    const store = fakeStore({}, { month: '2026-11', quota: 2500, quotaUsed: 2450 });
    const { uc, availability } = build({ store, identity: MOVIE });
    expect(await uc.execute({ ratingKey: '100' })).toBeNull();
    expect(availability.sources).not.toHaveBeenCalled();
  });

  it('falls back to the stale record when the lookup fails', async () => {
    const store = fakeStore({ 100: { key: '100', checkedAt: '2026-01-01T00:00:00Z', offers: [{ provider: 'peacock', type: 'sub' }] } });
    const { uc, availability } = build({ store, identity: MOVIE });
    availability.sources.mockRejectedValueOnce(new Error('boom'));
    expect((await uc.execute({ ratingKey: '100' })).provider).toBe('peacock');
  });

  it('shares one lookup between concurrent plays', async () => {
    const { uc, availability } = build({ identity: MOVIE, sources: [{ name: 'Hoopla', type: 'free' }] });
    await Promise.all([uc.execute({ ratingKey: '100' }), uc.execute({ ratingKey: '100' })]);
    expect(availability.sources).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled or given a bad key', async () => {
    const { uc, identityReader } = build({ identity: MOVIE, policy: { enabled: false } });
    expect(await uc.execute({ ratingKey: '100' })).toBeNull();
    expect(await uc.execute({ ratingKey: '../x' })).toBeNull();
    expect(identityReader.identify).not.toHaveBeenCalled();
  });
});
