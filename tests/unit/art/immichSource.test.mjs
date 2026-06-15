import { describe, it, expect, vi } from 'vitest';
import { createImmichSource } from '../../../backend/src/1_adapters/content/art/sources/immichSource.mjs';

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
    expect(c[0].meta.title).toBe('Lisbon');          // city
    expect(c[0].meta.artist).toContain('2019');      // formatted date
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
