import { describe, it, expect, vi } from 'vitest';
import { ContentFilterLibrary } from './ContentFilterLibrary.mjs';

const index = { map: {
  'plex:1': { title: 'Back to the Future', plexType: 'movie', vidangel: { slug: 'bttf', tagCount: 200 } },
  'plex:2': { title: 'Annie', plexType: 'movie', vidangel: { slug: 'annie', tagCount: 30 } },
  'plex:3': { title: 'A Show', plexType: 'show', vidangel: { slug: 's', tagCount: 10 } },
  'plex:4': { title: 'No Tags', plexType: 'movie', vidangel: { slug: 'n', tagCount: 0 } },
} };
const setup = () => {
  const repo = {
    getMatchIndex: vi.fn(async () => index),
    listOverrides: vi.fn(async () => ['1', '9']),
    getEdl: vi.fn(async (rk) => (rk === '1' || rk === '9' ? { title: rk === '9' ? 'Zed' : 'Back to the Future', sourceRef: { workId: Number(rk), tagSetId: 1 } } : null)),
    getRefinedEdl: vi.fn(async ({ workId }) => (workId === 1 ? { year: 1985, scenes: [], certification: { level: 'machine' } } : { certification: { level: 'none' } })),
    getOverride: vi.fn(async (rk) => (rk === '1' ? { review: { 'cue:a': { span: [1, 2] } } } : null)),
  };
  const records = { 1: { runs: [{ status: 'failed', step: 'refine', steps: [{ name: 'refine', error: 'boom' }] }], audit: { ok: true, digest: 'D', rows: [{ id: 'cue:a', in: 1, out: 2 }, { id: 'cue:b', in: 3, out: 4 }] } } };
  const jobs = { record: vi.fn(async (rk) => records[rk] || null) };
  const clock = { t: 0 };
  return { repo, jobs, clock, lib: new ContentFilterLibrary({ contentFilterRepository: repo, jobs, digestOf: async () => 'D', now: () => clock.t }) };
};

describe('ContentFilterLibrary', () => {
  it('lists index movies with tags plus override-only titles, by title, with stage, job and reviewed', async () => {
    const { lib } = setup();
    const { films } = await lib.list({});
    expect(films.map((f) => [f.ratingKey, f.stage])).toEqual([['2', 'rough'], ['1', 'machine'], ['9', 'refined']]);
    expect(films[1]).toMatchObject({ title: 'Back to the Future', year: 1985, job: { status: 'failed', step: 'refine', error: 'boom' }, reviewed: { n: 1, m: 2 } });
  });
  it('filters by stage and by a case-insensitive title query', async () => {
    const { lib } = setup();
    expect((await lib.list({ q: 'FUTURE' })).films.map((f) => f.ratingKey)).toEqual(['1']);
    expect((await lib.list({ stage: 'rough' })).films.map((f) => f.ratingKey)).toEqual(['2']);
  });
  it('a second call reads no files until invalidated', async () => {
    const { lib, repo } = setup();
    await lib.list({});
    const calls = repo.getEdl.mock.calls.length + repo.getMatchIndex.mock.calls.length;
    await lib.list({});
    expect(repo.getEdl.mock.calls.length + repo.getMatchIndex.mock.calls.length).toBe(calls);
    lib.invalidate('1');
    await lib.list({});
    expect(repo.getEdl.mock.calls.length).toBe(calls - 1 + 1);
  });
  it('a film with an active run shows its current step without invalidation', async () => {
    const { lib, jobs } = setup();
    let step = 'preflight';
    jobs.record.mockImplementation(async (rk) => (rk === '2' ? { runs: [{ status: 'running', step, steps: [] }] } : null));
    expect((await lib.list({ q: 'annie' })).films[0].job).toMatchObject({ status: 'running', step: 'preflight' });
    step = 'refine';
    expect((await lib.list({ q: 'annie' })).films[0].job).toMatchObject({ status: 'running', step: 'refine' });
  });
  it('re-reads the title index after 10 minutes (new matches appear without a restart)', async () => {
    const { lib, repo, clock } = setup();
    await lib.list({});
    await lib.list({});
    expect(repo.getMatchIndex).toHaveBeenCalledTimes(1);
    clock.t += 10 * 60 * 1000 + 1;
    await lib.list({});
    expect(repo.getMatchIndex).toHaveBeenCalledTimes(2);
  });

  describe('Plex linkage', () => {
    const plexWith = (keys) => ({
      getLibrarySections: vi.fn(async () => ({ MediaContainer: { Directory: [{ key: '1', type: 'movie' }, { key: '2', type: 'show' }] } })),
      getContainer: vi.fn(async (k) => (k === '/library/sections/1/all'
        ? { MediaContainer: { Metadata: keys.map((rk) => ({ ratingKey: rk, title: `Live ${rk}`, year: 2001 })) } }
        : (() => { throw new Error('shows must not be read'); })())),
    });
    const withPlex = (plex) => {
      const { repo, jobs, clock } = setup();
      repo.getMatchIndexWrittenAt = async () => '2026-06-30T00:00:00.000Z';
      return { repo, clock, lib: new ContentFilterLibrary({ contentFilterRepository: repo, jobs, digestOf: async () => 'D', now: () => clock.t, plex }) };
    };
    it('marks linked and unlinked films, adds a thumb and fills a missing year/title from Plex', async () => {
      const { lib } = withPlex(plexWith(['1', '9']));
      const { films, meta } = await lib.list({});
      const by = Object.fromEntries(films.map((f) => [f.ratingKey, f]));
      expect(by['1']).toMatchObject({ linked: true, thumb: '/api/v1/proxy/plex/library/metadata/1/thumb?w=120&h=180' });
      expect(by['2']).toMatchObject({ linked: false, thumb: null });
      expect(by['9']).toMatchObject({ linked: true, title: 'Zed' });
      expect(by['2'].year).toBeNull();
      expect(meta).toEqual({ indexedAt: '2026-06-30T00:00:00.000Z', total: 3, unlinked: 1 });
    });
    it('Plex down gives linked: null for every film and never fails the list', async () => {
      const plex = { getLibrarySections: vi.fn(async () => { throw new Error('down'); }), getContainer: vi.fn() };
      const { lib } = withPlex(plex);
      const { films, meta } = await lib.list({});
      expect(films.every((f) => f.linked === null && f.thumb === null)).toBe(true);
      expect(meta.unlinked).toBe(0);
    });
    it('reads the live keys once per TTL', async () => {
      const plex = plexWith(['1']);
      const { lib, clock } = withPlex(plex);
      await lib.list({}); await lib.list({});
      expect(plex.getLibrarySections).toHaveBeenCalledTimes(1);
      clock.t += 10 * 60 * 1000 + 1;
      await lib.list({});
      expect(plex.getLibrarySections).toHaveBeenCalledTimes(2);
    });
    it('without a plex client linked is null', async () => {
      const { lib } = withPlex(null);
      expect((await lib.list({})).films.every((f) => f.linked === null)).toBe(true);
    });

    it('two simultaneous list() calls share one Plex sweep', async () => {
      const plex = plexWith(['1']);
      const { lib } = withPlex(plex);
      await Promise.all([lib.list({}), lib.list({})]);
      expect(plex.getLibrarySections).toHaveBeenCalledTimes(1);
    });
    it('a Plex failure is retried after 30 s, not 10 minutes', async () => {
      const plex = plexWith(['1']);
      plex.getLibrarySections.mockRejectedValueOnce(new Error('blip'));
      const { lib, clock } = withPlex(plex);
      expect((await lib.list({})).films[0].linked).toBeNull();
      clock.t += 31 * 1000;
      expect((await lib.list({})).films.find((f) => f.ratingKey === '1').linked).toBe(true);
    });
  });
});
