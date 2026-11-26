// Newer Immich servers return an asset's people without `faces`; the boxes
// come from GET /api/faces?id=<asset>. The adapter fills them in on the
// single-asset paths the player uses (GET /api/v1/info → getItem).
import { describe, it, expect, vi } from 'vitest';
import { ImmichAdapter } from "../../../../../../__capabilities/content-catalog/server/adapters/providers/gallery/immich/ImmichAdapter.mjs";

const ASSET = 'aaaaaaaa-1111-2222-3333-444444444444';

const asset = (people) => ({
  id: ASSET,
  type: 'IMAGE',
  originalFileName: 'photo.jpg',
  exifInfo: { exifImageWidth: 4000, exifImageHeight: 3000 },
  people,
});

const face = (personId, x1) => ({
  id: `face-${personId}-${x1}`,
  boundingBoxX1: x1, boundingBoxY1: 10, boundingBoxX2: x1 + 100, boundingBoxY2: 110,
  imageWidth: 4000, imageHeight: 3000,
  person: personId ? { id: personId, name: personId } : null,
});

function makeAdapter(routes) {
  const get = vi.fn(async (url) => {
    for (const [match, respond] of routes) {
      if (url.includes(match)) return respond(url);
    }
    throw new Error(`unexpected GET ${url}`);
  });
  const adapter = new ImmichAdapter(
    { source: 'familyphotos', host: 'http://family', apiKey: 'k' },
    { httpClient: { get, post: vi.fn() } }
  );
  return { adapter, get };
}

describe('ImmichAdapter face lookup', () => {
  it('attaches /api/faces boxes to each person when the asset omits them', async () => {
    const { adapter, get } = makeAdapter([
      ['/api/faces?id=', () => ({ data: [face('liza', 100), face('kirby', 900), face(null, 2000)] })],
      [`/api/assets/${ASSET}`, () => ({ data: asset([{ id: 'liza', name: 'Liza' }, { id: 'kirby', name: 'Kirby' }]) })],
    ]);

    const item = await adapter.getItem(`familyphotos:${ASSET}`);

    expect(get.mock.calls.map(([u]) => u)).toContain(`http://family/api/faces?id=${ASSET}`);
    expect(item.metadata.people).toEqual([
      { name: 'Liza', id: 'liza', faces: [{ x1: 100, y1: 10, x2: 200, y2: 110, imageWidth: 4000, imageHeight: 3000 }] },
      { name: 'Kirby', id: 'kirby', faces: [{ x1: 900, y1: 10, x2: 1000, y2: 110, imageWidth: 4000, imageHeight: 3000 }] },
    ]);
  });

  it('keeps embedded faces and makes no extra request (older servers)', async () => {
    const embedded = [{ id: 'liza', name: 'Liza', faces: [face('liza', 5)] }];
    const { adapter, get } = makeAdapter([
      [`/api/assets/${ASSET}`, () => ({ data: asset(embedded) })],
    ]);

    const item = await adapter.getItem(`familyphotos:${ASSET}`);

    expect(get).toHaveBeenCalledTimes(1);
    expect(item.metadata.people[0].faces[0].x1).toBe(5);
  });

  it('skips the lookup for a photo with no people', async () => {
    const { adapter, get } = makeAdapter([
      [`/api/assets/${ASSET}`, () => ({ data: asset([]) })],
    ]);

    await adapter.getItem(`familyphotos:${ASSET}`);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('a failed face lookup still returns the photo, with empty faces', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { adapter } = makeAdapter([
      ['/api/faces?id=', () => { throw new Error('502'); }],
      [`/api/assets/${ASSET}`, () => ({ data: asset([{ id: 'liza', name: 'Liza' }]) })],
    ]);

    const item = await adapter.getItem(`familyphotos:${ASSET}`);

    expect(item.id).toBe(`familyphotos:${ASSET}`);
    expect(item.metadata.people).toEqual([{ name: 'Liza', id: 'liza', faces: [] }]);
    warn.mockRestore();
  });

  it('getViewable gets the same boxes', async () => {
    const { adapter } = makeAdapter([
      ['/api/faces?id=', () => ({ data: [face('liza', 300)] })],
      [`/api/assets/${ASSET}`, () => ({ data: asset([{ id: 'liza', name: 'Liza' }]) })],
    ]);

    const view = await adapter.getViewable(`familyphotos:${ASSET}`);
    expect(view.metadata.people[0].faces[0].x1).toBe(300);
  });
});
