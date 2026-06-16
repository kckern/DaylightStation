import { describe, it, expect, vi } from 'vitest';
import { createImmichSource, combinations } from '../../../backend/src/1_adapters/content/art/sources/immichSource.mjs';

const asset = (over = {}) => ({
  id: over.id || 'a1',
  type: over.type || 'IMAGE',
  exifInfo: { exifImageWidth: 1600, exifImageHeight: 1000, dateTimeOriginal: '2019-08-15T10:00:00Z', city: 'Lisbon', country: 'Portugal', ...(over.exifInfo || {}) },
  people: over.people || [],
  ...over,
});

const makeClient = () => ({
  getAlbums: vi.fn(async () => [{ id: 'alb1', albumName: 'Family Favorites' }]),
  getAlbum: vi.fn(async (id) => ({ id, assets: [asset({ id: 'a1' }), asset({ id: 'v1', type: 'VIDEO' })] })),
  getPeople: vi.fn(async () => [{ id: 'per1', name: 'Felix' }]),
  getPersonAssets: vi.fn(async () => [asset({ id: 'a2' })]),
  smartSearch: vi.fn(async () => [asset({ id: 'a3' })]),
});

const proxyPath = '/api/v1/proxy/immich';

describe('createImmichSource.resolveCandidates', () => {
  it('album by name → IMAGE candidates only, normalized', async () => {
    const client = makeClient();
    const fetchImageBytes = vi.fn(async () => Buffer.from('x'));
    const src = createImmichSource({ client, fetchImageBytes, proxyPath });
    const c = await src.resolveCandidates({ source: 'immich', album: 'Family Favorites' });
    expect(c).toHaveLength(1);                       // VIDEO dropped
    expect(c[0].id).toBe('immich:a1');
    expect(c[0].width).toBe(1600);
    expect(c[0].height).toBe(1000);
    expect(c[0].kind).toBe('landscape');
    expect(c[0].image).toBe('/api/v1/proxy/immich/assets/a1/thumbnail?size=preview');
    expect(c[0].meta.title).toBe('Lisbon');          // city (no people → location only)
    expect(c[0].meta.artist).toContain('2019');      // formatted date
  });

  it('labels people + location on the title line and the date alone beneath (no dup date)', async () => {
    const client = makeClient();
    client.getAlbum = vi.fn(async () => ({ assets: [
      asset({ id: 'p1', people: [{ name: 'Felix' }, { name: 'Milo' }] }),
    ] }));
    const src = createImmichSource({ client, fetchImageBytes: async () => Buffer.from('x'), proxyPath });
    const c = await src.resolveCandidates({ source: 'immich', album: 'Family Favorites' });
    expect(c[0].meta.title).toBe('Felix and Milo • Lisbon'); // people + location
    expect(c[0].meta.artist).toBe('August 2019');            // date only — no people, no city
    expect(c[0].meta.date).toBeNull();                       // folded into artist; not repeated
  });

  it('falls back to location only when no people are tagged', async () => {
    const client = makeClient();
    client.getAlbum = vi.fn(async () => ({ assets: [asset({ id: 'np' })] }));
    const src = createImmichSource({ client, fetchImageBytes: async () => Buffer.from('x'), proxyPath });
    const c = await src.resolveCandidates({ source: 'immich', album: 'Family Favorites' });
    expect(c[0].meta.title).toBe('Lisbon');
    expect(c[0].meta.artist).toBe('August 2019');
  });

  it('person selector resolves a name to id and fetches assets', async () => {
    const client = makeClient();
    const src = createImmichSource({ client, fetchImageBytes: async () => Buffer.from('x'), proxyPath });
    const c = await src.resolveCandidates({ source: 'immich', person: 'Felix' });
    expect(client.getPersonAssets).toHaveBeenCalledWith('per1');
    expect(c[0].id).toBe('immich:a2');
  });

  it('search selector uses smartSearch', async () => {
    const client = makeClient();
    const src = createImmichSource({ client, fetchImageBytes: async () => Buffer.from('x'), proxyPath });
    const c = await src.resolveCandidates({ source: 'immich', search: 'sunset' });
    expect(client.smartSearch).toHaveBeenCalledWith('sunset');
    expect(c[0].id).toBe('immich:a3');
  });

  it('drops assets without dimensions', async () => {
    const client = makeClient();
    client.getAlbum = vi.fn(async () => ({ assets: [{ id: 'nodim', type: 'IMAGE', exifInfo: {} }] }));
    const src = createImmichSource({ client, fetchImageBytes: async () => Buffer.from('x'), proxyPath });
    const c = await src.resolveCandidates({ source: 'immich', album: 'alb1' });
    expect(c).toHaveLength(0);
  });
});

describe('combinations', () => {
  it('returns all k-sized combinations (C(4,2) = 6 pairs)', () => {
    const c = combinations(['a', 'b', 'c', 'd'], 2);
    expect(c).toHaveLength(6);
    expect(c).toContainEqual(['a', 'b']);
    expect(c).toContainEqual(['c', 'd']);
  });
  it('k === length returns the whole set once', () => {
    expect(combinations(['a', 'b'], 2)).toEqual([['a', 'b']]);
  });
  it('k === 1 returns singletons', () => {
    expect(combinations(['a', 'b', 'c'], 1)).toEqual([['a'], ['b'], ['c']]);
  });
  it('k > length or k <= 0 returns []', () => {
    expect(combinations(['a'], 2)).toEqual([]);
    expect(combinations(['a', 'b'], 0)).toEqual([]);
  });
});

describe('createImmichSource people selector', () => {
  const img = (id) => ({ id, type: 'IMAGE', width: 1600, height: 1000, localDateTime: '2020-01-01T00:00:00Z' });
  const vid = (id) => ({ id, type: 'VIDEO', width: 1600, height: 1000 });

  const makePeopleClient = (over = {}) => ({
    getPeople: vi.fn(async () => ([
      { id: 'felix-id', name: 'Felix' }, { id: 'milo-id', name: 'Milo' },
      { id: 'alan-id', name: 'Alan' }, { id: 'soren-id', name: 'Soren' },
    ])),
    searchMetadata: vi.fn(async ({ personIds }) => {
      if (personIds.includes('felix-id') && personIds.includes('milo-id')) {
        return { items: [img('a1'), vid('v1')] };
      }
      return { items: [img('a1'), img('a2')] };
    }),
    ...over,
  });

  it('runs one search per pair, unions/dedupes, drops video, maps dims', async () => {
    const client = makePeopleClient();
    const src = createImmichSource({ client, fetchImageBytes: async () => Buffer.from('x'), proxyPath: '/api/v1/proxy/immich' });
    const c = await src.resolveCandidates({ source: 'immich', people: ['Felix', 'Milo', 'Alan', 'Soren'], minPeople: 2 });
    expect(client.searchMetadata).toHaveBeenCalledTimes(6);
    expect(client.searchMetadata.mock.calls[0][0].personIds).toHaveLength(2);
    const ids = c.map((x) => x.id).sort();
    expect(ids).toEqual(['immich:a1', 'immich:a2']);
    expect(c[0].width).toBe(1600);
  });

  it('skips names that do not resolve and combines the rest', async () => {
    const client = makePeopleClient({
      getPeople: vi.fn(async () => ([
        { id: 'felix-id', name: 'Felix' }, { id: 'milo-id', name: 'Milo' }, { id: 'alan-id', name: 'Alan' },
      ])),
    });
    const src = createImmichSource({ client, fetchImageBytes: async () => Buffer.from('x'), proxyPath: '/api/v1/proxy/immich' });
    await src.resolveCandidates({ source: 'immich', people: ['Felix', 'Milo', 'Alan', 'Soren'], minPeople: 2 });
    expect(client.searchMetadata).toHaveBeenCalledTimes(3);
  });

  it('returns [] when fewer than minPeople resolve', async () => {
    const client = makePeopleClient({ getPeople: vi.fn(async () => ([{ id: 'felix-id', name: 'Felix' }])) });
    const src = createImmichSource({ client, fetchImageBytes: async () => Buffer.from('x'), proxyPath: '/api/v1/proxy/immich' });
    const c = await src.resolveCandidates({ source: 'immich', people: ['Felix', 'Milo'], minPeople: 2 });
    expect(c).toEqual([]);
    expect(client.searchMetadata).not.toHaveBeenCalled();
  });
});
