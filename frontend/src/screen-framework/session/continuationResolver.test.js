import { describe, it, expect, vi } from 'vitest';
import { createContinuationResolver } from './continuationResolver.js';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const qItem = (id, extra = {}) => ({ id: `plex:${id}`, contentId: `plex:${id}`, title: `T${id}`, format: 'video', mediaUrl: `/m/${id}`, duration: 400, lastPlayed: null, ...extra });

function fakeApi(routes) {
  return vi.fn(async (path) => {
    for (const [pattern, body] of routes) {
      if (path.startsWith(pattern)) {
        if (body instanceof Error) throw body;
        return typeof body === 'function' ? body(path) : body;
      }
    }
    throw new Error(`unexpected ${path}`);
  });
}

const noFleet = [['api/v1/device/config', { devices: {} }]];

describe('createContinuationResolver', () => {
  it('stops when the adapter fell back to the whole library (no container)', async () => {
    const api = fakeApi([
      ['api/v1/siblings/plex/55854', { parent: { id: 'library:1', title: 'Movies' }, items: [{ id: 'plex:1' }, { id: 'plex:55854' }] }],
      ...noFleet,
    ]);
    const resolve = createContinuationResolver({ api, ownerId: 'tv', now: () => NOW });
    await expect(resolve({ finished: { contentId: 'plex:55854' } })).resolves.toEqual([]);
    expect(api).not.toHaveBeenCalledWith(expect.stringMatching(/^api\/v1\/queue/));
  });

  it('climbs from the season into the show, in natural order, preferring unplayed', async () => {
    const show = [
      qItem(11, { parentIndex: 1, itemIndex: 1, lastPlayed: daysAgo(1) }),
      qItem(13, { parentIndex: 1, itemIndex: 3 }),
      qItem(12, { parentIndex: 1, itemIndex: 2 }),
      qItem(21, { parentIndex: 2, itemIndex: 1 }),
    ];
    const api = fakeApi([
      ['api/v1/siblings/plex/12', {
        parent: { id: 'plex:500', type: 'season' },
        items: [{ id: 'plex:11' }, { id: 'plex:12' }, { id: 'plex:13' }],
        ancestors: [{ id: 'plex:400', type: 'show' }, { id: 'plex:500', type: 'season' }],
      }],
      ['api/v1/queue/plex:400', { items: show }],
      ...noFleet,
    ]);
    const resolve = createContinuationResolver({ api, ownerId: 'tv', now: () => NOW });
    const batch = await resolve({ finished: { contentId: 'plex:12' }, queue: { items: [] } });
    expect(batch.map(i => i.contentId)).toEqual(['plex:13', 'plex:21', 'plex:11']);
    expect(batch[0]).toMatchObject({ mediaUrl: '/m/13', format: 'video' });
  });

  it('plays the rest of a playlist in playlist order', async () => {
    const api = fakeApi([
      ['api/v1/siblings/plex/2', { parent: { id: 'plex:pl', type: 'playlist' }, items: [{ id: 'plex:1' }, { id: 'plex:2' }, { id: 'plex:3' }] }],
      ['api/v1/queue/plex:pl', { items: [qItem(3), qItem(1), qItem(2)] }],
      ...noFleet,
    ]);
    const resolve = createContinuationResolver({ api, ownerId: 'tv', now: () => NOW });
    expect((await resolve({ finished: { contentId: 'plex:2' } })).map(i => i.contentId)).toEqual(['plex:3']);
  });

  it('never adds something already queued here or playing on another screen', async () => {
    const api = fakeApi([
      ['api/v1/siblings/plex/1', { parent: { id: 'plex:c', type: 'collection' }, items: [1, 2, 3, 4].map(n => ({ id: `plex:${n}` })) }],
      ['api/v1/queue/plex:c', { items: [qItem(1), qItem(2), qItem(3), qItem(4)] }],
      ['api/v1/device/config', { devices: { tv: { content_control: {} }, office: { content_control: {} }, cam: {} } }],
      ['api/v1/device/office/session', { state: 'playing', currentItem: { contentId: 'plex:3' } }],
    ]);
    const resolve = createContinuationResolver({ api, ownerId: 'tv', now: () => NOW });
    const batch = await resolve({ finished: { contentId: 'plex:1' }, queue: { items: [{ contentId: 'plex:2' }] } });
    expect(batch.map(i => i.contentId)).toEqual(['plex:4']);
    expect(api).not.toHaveBeenCalledWith('api/v1/device/tv/session');
    expect(api).not.toHaveBeenCalledWith('api/v1/device/cam/session');
  });

  it('treats an unreadable fleet as "nothing playing elsewhere" and an adapter failure as nothing similar', async () => {
    const ok = fakeApi([
      ['api/v1/siblings/plex/1', { parent: { id: 'plex:c' }, items: [{ id: 'plex:1' }, { id: 'plex:2' }] }],
      ['api/v1/queue/plex:c', { items: [qItem(1), qItem(2)] }],
      ['api/v1/device/config', new Error('down')],
    ]);
    expect((await createContinuationResolver({ api: ok, ownerId: 'tv', now: () => NOW })({ finished: { contentId: 'plex:1' } })).map(i => i.contentId))
      .toEqual(['plex:2']);
    const broken = fakeApi([['api/v1/siblings/', new Error('404')], ...noFleet]);
    await expect(createContinuationResolver({ api: broken, ownerId: 'tv', now: () => NOW })({ finished: { contentId: 'plex:1' } })).resolves.toEqual([]);
  });
});
