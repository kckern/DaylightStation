import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AmbianceService } from '../../../__app_modules/media/art/server/application/AmbianceService.mjs';
import { FilesystemAmbianceCatalog } from '../../../__app_modules/media/art/server/adapters/FilesystemAmbianceCatalog.mjs';
import { createArtAdapter } from '../../../__app_modules/media/art/server/adapters/ArtAdapter.mjs';
import { createArtRouter } from '../../../__app_modules/media/art/server/api/art.mjs';

const annotation = (changes = {}) => ({ themes: ['comfort'], moods: ['contemplative'], seasons: [], energy: 0, intensity: 1,
  review: { status: 'approved', profiles: ['quiet'], reviewer: 'curator', reviewedAt: '2026-01-01', confidence: 0.95, reason: 'Reviewed', evidence: [{ kind: 'visual', path: 'fixture.jpg' }] }, ...changes });
const doc = () => ({ version: 1, profiles: { quiet: { maxEnergy: 1, maxIntensity: 2, excludedSeasons: ['christmas'], fallbackArtIds: ['religious/neutral'] } },
  tracks: { 'plex:101': annotation(), 'plex:102': annotation({ seasons: ['christmas'] }), 'plex:103': annotation({ review: undefined }) },
  artworks: { 'religious/comfort': annotation(), 'religious/neutral': annotation({ themes: [], moods: [] }) } });
const candidate = (id, kind = 'portrait') => ({ id, kind, image: `/media/img/art/${id}.jpg`, meta: { title: id }, loadImage: async () => { throw new Error('no color fixture'); } });
const makeService = (catalog = doc(), ids = ['religious/comfort', 'religious/neutral']) => new AmbianceService({
  catalog: { load: async () => catalog },
  artworkSource: {
    resolveReviewedArtworks: async () => Object.fromEntries(ids.map((id) => [id, candidate(id)])),
    presentArtwork: async (item) => ({ mode: 'single', panels: [{ image: item.image, meta: item.meta }], matte: null }),
  }, random: () => 0,
});

describe('reviewed ambiance service', () => {
  it('returns only approved nonseasonal recording IDs', async () => expect(await makeService().getTracks('quiet')).toEqual({ trackIds: ['plex:101'] }));
  it('selects one available reviewed artwork for the actual recording', async () => {
    const out = await makeService().match({ profile: 'quiet', trackId: 'plex:101' });
    expect(out).toMatchObject({ mode: 'single', match: { artId: 'religious/comfort', kind: 'matched' } });
    expect(out.panels).toHaveLength(1);
  });
  it('ignores missing image assets and uses the vetted fallback', async () => {
    expect(await makeService(doc(), ['religious/neutral']).match({ profile: 'quiet', trackId: 'plex:101' }))
      .toMatchObject({ match: { artId: 'religious/neutral', kind: 'fallback' } });
  });
  it('returns neutral when even the vetted fallback is missing', async () => expect(await makeService(doc(), []).match({ profile: 'quiet', trackId: 'plex:101' })).toMatchObject({ mode: 'neutral', panels: [], match: { kind: 'neutral' } }));
  it('never displays art for an unknown, unreviewed or seasonal recording', async () => {
    for (const trackId of ['plex:102', 'plex:103', 'plex:999']) {
      expect(await makeService().match({ profile: 'quiet', trackId })).toMatchObject({ mode: 'neutral', panels: [] });
    }
  });
  it('reports an unknown profile', async () => expect(makeService().getTracks('absent')).rejects.toMatchObject({ status: 404 }));
  it('records recent selections without allowing irrelevant art into the pool', async () => {
    const catalog = doc(); catalog.artworks['religious/alternative'] = annotation();
    const service = makeService(catalog, ['religious/comfort', 'religious/alternative']);
    const first = await service.match({ profile: 'quiet', trackId: 'plex:101' });
    const second = await service.match({ profile: 'quiet', trackId: 'plex:101' });
    expect([first.match.artId, second.match.artId]).toEqual(['religious/comfort', 'religious/alternative']);
  });
});

describe('ambiance catalog', () => {
  it('fails closed for missing, malformed or unsupported catalogs and rereads corrected data', async () => {
    const householdDir = await mkdtemp(path.join(os.tmpdir(), 'ambiance-catalog-'));
    const catalog = new FilesystemAmbianceCatalog({ householdDir, logger: { warn() {} } });
    expect((await catalog.load()).profiles).toEqual({});
    await mkdir(path.join(householdDir, 'art'));
    const file = path.join(householdDir, 'art', 'ambiance.yml');
    for (const text of ['profiles: [', '{"version":9,"profiles":{"quiet":{}}}']) {
      await writeFile(file, text); expect((await catalog.load()).profiles).toEqual({});
    }
    await writeFile(file, JSON.stringify(doc()));
    expect((await catalog.load()).tracks['plex:101'].themes).toEqual(['comfort']);
  });
});

describe('single-art presentation', () => {
  it('resolves only requested art IDs and never pairs a portrait', async () => {
    const portrait = { ...candidate('christ/gentle'), loadImage: async () => ({ resize() {}, bitmap: { data: new Uint8Array([50, 70, 90, 255]) } }) }; const other = candidate('christ/other');
    const adapter = createArtAdapter({ imgBasePath: '/unused', recencyStore: null, logger: { warn() {}, info() {} }, artSource: { resolveCandidates: async () => [portrait, other] } });
    const found = await adapter.resolveArtworks(['religious/christ/gentle', '../escape']);
    expect(Object.keys(found)).toEqual(['religious/christ/gentle']);
    const out = await adapter.presentArtwork(found['religious/christ/gentle']);
    expect(out.mode).toBe('single'); expect(out.panels).toHaveLength(1);
    expect(out.panels[0].meta.title).toBe('christ/gentle');
  });
});

describe('ambiance API', () => {
  const response = () => { const r = { statusCode: 200 }; r.status = (v) => { r.statusCode = v; return r; }; r.json = (v) => { r.body = v; return r; }; return r; };
  const handle = (router, route) => router.stack.find((l) => l.route?.path === route)?.route.stack.at(-1).handle;
  const router = () => createArtRouter({ artService: { selectFeatured() {}, getPreset() {} }, ambianceService: makeService(), logger: { warn() {}, debug() {} } });
  it('serves approved track eligibility', async () => {
    const r = response(); await handle(router(), '/ambiance/:profile/tracks')({ params: { profile: 'quiet' } }, r, () => {});
    expect(r.body).toEqual({ trackIds: ['plex:101'] });
  });
  it('serves the single matched art response', async () => {
    const r = response(); await handle(router(), '/ambiance/:profile/match')({ params: { profile: 'quiet' }, body: { trackId: 'plex:101', recentIds: [] } }, r, () => {});
    expect(r.body.panels).toHaveLength(1); expect(r.body.match.kind).toBe('matched');
  });
  it('rejects malformed match requests', async () => {
    for (const body of [{}, { trackId: 123 }, { trackId: 'plex:101', recentIds: 'bad' }]) {
      const r = response(); await handle(router(), '/ambiance/:profile/match')({ params: { profile: 'quiet' }, body }, r, () => {});
      expect(r.statusCode).toBe(400);
    }
  });
});
