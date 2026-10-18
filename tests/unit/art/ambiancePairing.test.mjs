import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { Jimp } from 'jimp';
import { AmbianceService } from '../../../__app_modules/media/art/server/application/AmbianceService.mjs';
import { createArtAdapter } from '../../../__app_modules/media/art/server/adapters/ArtAdapter.mjs';
import { createArtRecencyStore } from '../../../__app_modules/media/art/server/adapters/artRecencyStore.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture({ count = 3, kind = 'portrait', changes = {}, policy = {} } = {}) {
  const bytes = await new Jimp({ width: 20, height: 30, color: 0x668866ff }).getBuffer('image/png');
  const record = { themes: ['comfort'], moods: ['contemplative'], seasons: [], energy: 0, intensity: 1, mediumKind: 'painting', review: {
    status: 'approved', profiles: ['quiet'], reviewer: 'curator', reviewedAt: '2026-01-01', reason: 'Viewed exact asset',
    evidence: [{ kind: 'visual', sha256: createHash('sha256').update(bytes).digest('hex'), path: 'fixture.png' }],
  } };
  const candidates = Array.from({length: count}, (_, i) => ({ id: `Work${i}`, kind,
    image: `/media/img/art/sacred/Work${i}.png`, meta: { title: `Work${i}`, artist: 'Painter', date: '1875' },
    readBytes: async () => bytes,
  }));
  const catalog = { profiles: {quiet: { maxEnergy: 1, maxIntensity: 2, portraitPairing: true, repeatWindow: 50, ...policy }},
    tracks: {'plex:101': record}, artworks: Object.fromEntries(candidates.map((c, i) => [`sacred/${c.id}`, {...record, ...changes[i]}])) };
  const adapter = createArtAdapter({ imgBasePath: '/unused', recencyStore: null, logger: {info() {}, warn() {}},
    artSource: {resolveCandidates: async () => candidates} });
  const service = (recencyStore) => new AmbianceService({ catalog: {load: async () => catalog}, artworkSource: adapter, random: () => 0, recencyStore });
  return { candidates, catalog, service };
}
const request = {profile: 'quiet', trackId: 'plex:101'};

describe('reviewed ambiance portrait pairs', () => {
  it('presents two distinct reviewed relevant portraits with both dates intact', async () => {
    const {service} = await fixture();
    const result = await service().match(request);
    expect(result.mode).toBe('diptych');
    expect(result.panels.map(p => [p.meta.title, p.meta.date])).toEqual([['Work0', '1875'], ['Work1', '1875']]);
    expect(result.match.companion.artId).toBe('sacred/Work1');
  });
  it('leaves landscape primaries single', async () => {
    const {service} = await fixture({kind: 'landscape'});
    expect(await service().match(request)).toMatchObject({mode: 'single', panels: [{meta: {title: 'Work0'}}]});
  });
  it('leaves a portrait single when other portraits are seasonal or unrelated', async () => {
    const {service} = await fixture({changes: {1: {seasons: ['christmas']}, 2: {themes: ['creation'], moods: []}}, policy: {excludedSeasons: ['christmas']}});
    const result = await service().match(request);
    expect(result.mode).toBe('single');
    expect(result.panels).toHaveLength(1);
  });
  it('rejects replaced companion bytes without discarding a valid primary', async () => {
    const {service, candidates} = await fixture({count: 2});
    candidates[1].readBytes = async () => Buffer.from('unreviewed replacement');
    const result = await service().match(request);
    expect(result.mode).toBe('single');
    expect(result.panels.map(p => p.meta.title)).toEqual(['Work0']);
  });
  it('does not pair emotionally opposed portraits even when each matches the song', async () => {
    const {service} = await fixture({count: 2, changes: {0: {moods: ['joyful']}, 1: {moods: ['somber']}}});
    const result = await service().match(request);
    expect(result.mode).toBe('single');
    expect(result.panels).toHaveLength(1);
  });
  it('counts both displayed panels for subsequent repeat spacing', async () => {
    const {service} = await fixture({count: 4});
    const instance = service();
    const first = await instance.match(request);
    const second = await instance.match(request);
    expect(first.panels.map(p => p.meta.title)).toEqual(['Work0', 'Work1']);
    expect(second.panels.map(p => p.meta.title)).toEqual(['Work2', 'Work3']);
  });
});

describe('ambiance repeat spacing', () => {
  it('retains more than twenty selections when fresh relevant artwork remains', async () => {
    const {service} = await fixture({count: 26, kind: 'landscape'});
    const instance = service();
    const ids = [];
    for(let i=0; i<26; i++) ids.push((await instance.match(request)).match.artId);
    expect(new Set(ids).size).toBe(26);
  });
  it('remembers displayed work across service and store recreation', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ambiance-recency-')); roots.push(dir);
    const filePath = path.join(dir, 'ambiance.yml');
    const {service} = await fixture({kind: 'landscape'});
    const a = service(createArtRecencyStore({filePath}));
    const first = await a.match(request);
    const b = service(createArtRecencyStore({filePath}));
    const second = await b.match(request);
    expect([first.match.artId, second.match.artId]).toEqual(['sacred/Work0', 'sacred/Work1']);
  });
  it('serializes overlapping matches so both cannot select the same fresh work', async () => {
    const {service} = await fixture({kind: 'landscape'});
    const instance = service();
    const results = await Promise.all([instance.match(request), instance.match(request)]);
    expect(results.map(result => result.match.artId)).toEqual(['sacred/Work0', 'sacred/Work1']);
  });
});
