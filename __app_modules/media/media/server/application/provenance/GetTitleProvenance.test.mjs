import { describe, it, expect, vi } from 'vitest';
import { GetTitleProvenance } from './GetTitleProvenance.mjs';
import { parseRules } from '../../domain/provenance/rules.mjs';
import { parseServices } from '../../domain/provenance/provenance.mjs';
import { parseSecondary, parseJudge } from '../../domain/provenance/rules.mjs';

// The household's service map, as config spells it (only what these tests use).
const SERVICES = parseServices([
  { provider: 'tubi', label: 'Tubi', names: ['Tubi TV', 'Tubi'] },
  { provider: 'hoopla', label: 'Hoopla', names: ['Hoopla'] },
  { provider: 'vidangel', label: 'VidAngel', names: ['VidAngel'] },
  { provider: 'peacock', label: 'Peacock', names: ['Peacock'], paid: true },
  { provider: 'netflix', label: 'Netflix', names: ['Netflix'], paid: true },
]);

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

function build({ store = fakeStore(), identity, sources = [], quotaUsed = 10, policy = {}, logos = () => true, contentFilter = null, decisions = null } = {}) {
  const identityReader = { identify: vi.fn(async (rk) => (typeof identity === 'function' ? identity(rk) : identity)) };
  const availability = { sources: vi.fn(async () => ({ sources, quota: 2500, quotaUsed })) };
  const uc = new GetTitleProvenance({
    identityReader, availability, store,
    logos: { has: logos },
    policy: () => ({ enabled: true, kinds: ['movie', 'show'], tiers: { free: ['tubi', 'hoopla'], subscribed: ['peacock'] }, refreshDays: 30, quotaReserve: 100, services: SERVICES, ...policy }),
    clock: () => NOW, logger: silent, contentFilter, decisions,
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

  it('adds the secondary logo the config names for the chosen service', async () => {
    const secondary = parseSecondary([{ logo: 'isp', label: 'ISP', for: 'all' }, { logo: 'pass-a', label: 'Pass A', for: 'paid', except: ['peacock'] }]);
    const netflix = build({ identity: MOVIE, sources: [{ name: 'Netflix', type: 'sub' }], policy: { secondary } });
    expect((await netflix.uc.execute({ ratingKey: '100' })).secondary).toEqual([{ logo: 'isp', name: 'ISP' }, { logo: 'pass-a', name: 'Pass A' }]);
    const peacock = build({ identity: MOVIE, sources: [{ name: 'Peacock', type: 'sub' }], policy: { secondary } });
    expect((await peacock.uc.execute({ ratingKey: '100' })).secondary).toEqual([{ logo: 'isp', name: 'ISP' }]);
    const noFile = build({ identity: MOVIE, sources: [{ name: 'Netflix', type: 'sub' }], policy: { secondary }, logos: (p) => p !== 'pass-a' });
    expect((await noFile.uc.execute({ ratingKey: '100' })).secondary).toEqual([{ logo: 'isp', name: 'ISP' }]);
  });

  it('serves a fresh record without a lookup (the title\'s facts are still read, for the rules)', async () => {
    const store = fakeStore({ 100: { key: '100', kind: 'movie', checkedAt: '2026-11-10T00:00:00Z', offers: [{ provider: 'peacock', type: 'sub' }] } });
    const { uc, availability, identityReader } = build({ store, identity: MOVIE });
    expect((await uc.execute({ ratingKey: '100' })).provider).toBe('peacock');
    expect(availability.sources).not.toHaveBeenCalled();
    expect(identityReader.identify).toHaveBeenCalledTimes(1);
  });

  it('still answers from a cached record when the title cannot be read', async () => {
    const store = fakeStore({ 100: { key: '100', kind: 'movie', checkedAt: '2026-11-10T00:00:00Z', offers: [{ provider: 'peacock', type: 'sub' }] } });
    const { uc } = build({ store, identity: null });
    expect((await uc.execute({ ratingKey: '100' })).provider).toBe('peacock');
  });

  it('refreshes a stale record', async () => {
    const store = fakeStore({ 100: { key: '100', kind: 'movie', checkedAt: '2026-09-01T00:00:00Z', offers: [{ provider: 'peacock', type: 'sub' }] } });
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
    const store = fakeStore({ 100: { key: '100', kind: 'movie', checkedAt: '2026-01-01T00:00:00Z', offers: [{ provider: 'peacock', type: 'sub' }] } });
    const { uc, availability } = build({ store, identity: MOVIE });
    availability.sources.mockRejectedValueOnce(new Error('boom'));
    expect((await uc.execute({ ratingKey: '100' })).provider).toBe('peacock');
  });

  it('shares one lookup between concurrent plays', async () => {
    const { uc, availability } = build({ identity: MOVIE, sources: [{ name: 'Hoopla', type: 'free' }] });
    await Promise.all([uc.execute({ ratingKey: '100' }), uc.execute({ ratingKey: '100' })]);
    expect(availability.sources).toHaveBeenCalledTimes(1);
  });

  it('shows only the configured kinds (movies by default)', async () => {
    const show = { key: '200', kind: 'show', title: 'Show', tmdb: '1396' };
    const a = build({ identity: show, sources: [{ name: 'Peacock', type: 'sub' }], policy: { kinds: undefined } });
    expect(await a.uc.execute({ ratingKey: '201' })).toBeNull();
    const b = build({ identity: MOVIE, sources: [{ name: 'Peacock', type: 'sub' }], policy: { kinds: undefined } });
    expect((await b.uc.execute({ ratingKey: '100' })).provider).toBe('peacock');
  });

  it('never spends a lookup on a kind it does not show (a music track, a show when only movies are on)', async () => {
    const track = { key: '300', kind: 'track', title: 'Song' };
    const a = build({ identity: track, policy: { kinds: undefined } });
    expect(await a.uc.execute({ ratingKey: '300' })).toBeNull();
    expect(a.availability.sources).not.toHaveBeenCalled();
    expect(a.store.put).not.toHaveBeenCalled();
    const show = { key: '200', kind: 'show', title: 'Show', tmdb: '1396' };
    const b = build({ identity: show, sources: [{ name: 'Peacock', type: 'sub' }], policy: { kinds: undefined } });
    expect(await b.uc.execute({ ratingKey: '201' })).toBeNull();
    expect(b.availability.sources).not.toHaveBeenCalled();
  });

  it('does nothing when disabled or given a bad key', async () => {
    const { uc, identityReader } = build({ identity: MOVIE, policy: { enabled: false } });
    expect(await uc.execute({ ratingKey: '100' })).toBeNull();
    expect(await uc.execute({ ratingKey: '../x' })).toBeNull();
    expect(identityReader.identify).not.toHaveBeenCalled();
  });

  describe('rules', () => {
    const rules = parseRules({
      overrides: [
        { provider: 'vidangel', when: { content_filter: 'active' } },
        { provider: 'living-scriptures', when: { collection: ['Living Scriptures'] } },
      ],
      priority: [
        { name: 'subscribed', providers: ['prime-video', 'peacock'] },
        { name: 'library', providers: ['hoopla', 'kanopy'] },
        { name: 'free', providers: ['tubi'] },
        { name: 'other', providers: 'any' },
      ],
      fallbacks: [
        { provider: 'archive-org', when: { kind: ['movie'], year_before: 1950 } },
        { provider: 'curiosity-stream', when: { library: ['Documentaries'] } },
        { provider: ['peacock', 'prime-video'], when: 'always' },
      ],
    });
    const FILM = { ...MOVIE, year: 1984, library: 'Movies', collections: [], studio: 'Orion' };

    it('a paid service beats a library one, which beats a free one', async () => {
      const { uc } = build({ identity: FILM, policy: { rules }, sources: [{ name: 'Tubi', type: 'free' }, { name: 'Hoopla', type: 'free' }, { name: 'Peacock', type: 'sub' }] });
      expect(await uc.execute({ ratingKey: '100' })).toMatchObject({ provider: 'peacock', source: 'availability', tier: 'subscribed' });
    });

    it('an override wins over the offers and spends no lookup', async () => {
      const contentFilter = { isActive: vi.fn(async () => true) };
      const { uc, availability } = build({ identity: FILM, policy: { rules }, sources: [{ name: 'Paramount+', type: 'sub' }], contentFilter });
      expect(await uc.execute({ ratingKey: '100' })).toMatchObject({ provider: 'vidangel', name: 'VidAngel', source: 'override', rule: 'content_filter=true' });
      expect(contentFilter.isActive).toHaveBeenCalledWith('100');
      expect(availability.sources).not.toHaveBeenCalled();
    });

    it('a collection override (Living Scriptures)', async () => {
      const { uc } = build({ identity: { ...FILM, collections: ['Living Scriptures', 'LDS'] }, policy: { rules } });
      expect((await uc.execute({ ratingKey: '100' })).provider).toBe('living-scriptures');
    });

    it('falls back by year, then library, then a stable pick of Peacock or Prime', async () => {
      const old = build({ identity: { ...FILM, year: 1931 }, policy: { rules } });
      expect(await old.uc.execute({ ratingKey: '100' })).toMatchObject({ provider: 'archive-org', source: 'fallback' });
      const doc = build({ identity: { ...FILM, library: 'Documentaries' }, policy: { rules } });
      expect((await doc.uc.execute({ ratingKey: '100' })).provider).toBe('curiosity-stream');
      const any = build({ identity: FILM, policy: { rules } });
      const first = (await any.uc.execute({ ratingKey: '100' })).provider;
      expect(['peacock', 'prime-video']).toContain(first);
      expect((await any.uc.execute({ ratingKey: '100' })).provider).toBe(first);
    });

    it('stays out of libraries it is not given', async () => {
      const { uc } = build({ identity: { ...FILM, library: 'Home Video Archive' }, policy: { rules, libraries: ['Movies', 'Documentaries'] } });
      expect(await uc.execute({ ratingKey: '100' })).toBeNull();
    });

    it('skips a provider with no logo and takes the next rule', async () => {
      const { uc } = build({ identity: { ...FILM, year: 1931 }, policy: { rules }, logos: (p) => p !== 'archive-org' });
      expect(['peacock', 'prime-video']).toContain((await uc.execute({ ratingKey: '100' })).provider);
    });
  });

  describe('live channels', () => {
    const live = { sources: ['plex-live'], provider: 'plex-live-tv', label: 'Plex Live TV' };

    it('answers a listed live source with its one provider, reading no facts and spending no lookup', async () => {
      const { uc, identityReader, availability } = build({ identity: MOVIE, policy: { live } });
      const out = await uc.execute({ contentId: 'plex-live:nfl-channel' });
      expect(out).toMatchObject({ ratingKey: 'plex-live:nfl-channel', provider: 'plex-live-tv', name: 'Plex Live TV', source: 'live', tier: 'live' });
      expect(identityReader.identify).not.toHaveBeenCalled();
      expect(availability.sources).not.toHaveBeenCalled();
    });

    it('answers nothing for an unlisted source, no live block, a missing logo, or the scene turned off', async () => {
      expect(await build({ policy: { live } }).uc.execute({ contentId: 'youtube:abc' })).toBeNull();
      expect(await build({ policy: { live: null } }).uc.execute({ contentId: 'plex-live:nfl-channel' })).toBeNull();
      expect(await build({ policy: { live }, logos: (id) => id !== 'plex-live-tv' }).uc.execute({ contentId: 'plex-live:nfl-channel' })).toBeNull();
      expect(await build({ policy: { live, enabled: false } }).uc.execute({ contentId: 'plex-live:nfl-channel' })).toBeNull();
    });
  });
});

describe('GetTitleProvenance judge', () => {
  const judge = parseJudge({ instructions: 'Which service?', min_confidence: 0.5, choices: { crunchyroll: 'anime', 'tf1-plus': 'French', youtube: 'other' } });
  const rules = parseRules({ fallbacks: [
    { name: 'early film', provider: 'archive-org', when: { year_before: 1950 } },
    { name: 'ask', judge: true, when: 'always' },
    { name: 'anything else', provider: 'peacock', when: 'always' },
  ] });
  const SHOW = { key: '300', kind: 'show', title: 'Goldorak', year: 1975, imdb: null, tmdb: null, genres: ['Anime'], countries: ['Japan'] };
  const gateway = (answer) => ({ isConfigured: () => true, evaluate: vi.fn(async () => (answer instanceof Error ? Promise.reject(answer) : { model: 'jev-1', answers: { service: answer } })) });

  it('asks once, stores the pick, and reuses it', async () => {
    const decisions = gateway({ type: 'choice', choice: 'crunchyroll', confidence: 0.9 });
    const store = fakeStore();
    const { uc } = build({ store, identity: SHOW, decisions, policy: { rules, judge } });
    expect(await uc.execute({ ratingKey: '300' })).toMatchObject({ provider: 'crunchyroll', source: 'judge', rule: 'ask' });
    expect(store.data['300'].judged).toMatchObject({ provider: 'crunchyroll', confidence: 0.9, model: 'jev-1', signature: judge.signature });
    const [state, questions] = decisions.evaluate.mock.calls[0];
    expect(state).toMatchObject({ title: 'Goldorak', genres: 'Anime', countries: 'Japan' });
    expect(Object.keys(questions.service.options)).toEqual(['crunchyroll', 'tf1-plus', 'youtube']);
    await uc.execute({ ratingKey: '300' });
    expect(decisions.evaluate).toHaveBeenCalledTimes(1);
  });
  it('asks again when the brief changes', async () => {
    const decisions = gateway({ type: 'choice', choice: 'tf1-plus', confidence: 0.8 });
    const store = fakeStore({ 300: { key: '300', kind: 'show', checkedAt: '2026-11-19T00:00:00Z', offers: [], judged: { provider: 'crunchyroll', signature: 'old' } } });
    const { uc } = build({ store, identity: SHOW, decisions, policy: { rules, judge } });
    expect((await uc.execute({ ratingKey: '300' })).provider).toBe('tf1-plus');
    expect(decisions.evaluate).toHaveBeenCalledTimes(1);
  });
  it('falls through when unsure (and remembers that), or when the model fails', async () => {
    const unsure = gateway({ type: 'choice', choice: 'crunchyroll', confidence: 0.2 });
    const store = fakeStore();
    const a = build({ store, identity: SHOW, decisions: unsure, policy: { rules, judge } });
    expect(await a.uc.execute({ ratingKey: '300' })).toMatchObject({ provider: 'peacock', source: 'fallback' });
    expect(store.data['300'].judged).toMatchObject({ provider: null, choice: 'crunchyroll' });
    await a.uc.execute({ ratingKey: '300' });
    expect(unsure.evaluate).toHaveBeenCalledTimes(1);

    const failing = gateway(new Error('timeout'));
    const b = build({ identity: SHOW, decisions: failing, policy: { rules, judge } });
    expect((await b.uc.execute({ ratingKey: '300' })).provider).toBe('peacock');
  });
  it('keeps rules above the judge, and skips it with no gateway', async () => {
    const decisions = gateway({ type: 'choice', choice: 'crunchyroll', confidence: 0.9 });
    const old = build({ identity: { ...SHOW, year: 1930 }, decisions, policy: { rules, judge } });
    expect((await old.uc.execute({ ratingKey: '300' })).provider).toBe('archive-org');
    expect(decisions.evaluate).not.toHaveBeenCalled();
    const none = build({ identity: SHOW, policy: { rules, judge } });
    expect((await none.uc.execute({ ratingKey: '300' })).provider).toBe('peacock');
  });
  it('only offers choices that have a logo', async () => {
    const decisions = gateway({ type: 'choice', choice: 'youtube', confidence: 0.9 });
    const { uc } = build({ identity: SHOW, decisions, policy: { rules, judge }, logos: (p) => p !== 'tf1-plus' });
    await uc.execute({ ratingKey: '300' });
    expect(Object.keys(decisions.evaluate.mock.calls[0][1].service.options)).toEqual(['crunchyroll', 'youtube']);
  });
});
