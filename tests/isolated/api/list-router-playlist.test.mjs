import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createListRouter } from '#backend/src/4_api/v1/routers/list.mjs';

/**
 * Test that the list router wraps playlists as single container items.
 * When /api/v1/list/plex/{playlistId} is called and the ID is a playlist,
 * the response should contain a single "show" container item (not the playlist's tracks).
 */
describe('list router playlist-as-show', () => {
  let app;
  let mockAdapter;
  let mockContentIdResolver;

  beforeEach(() => {
    // Mock adapter with playlist behavior
    mockAdapter = {
      getList: jest.fn(),
      getItem: jest.fn(),
      getContainerInfo: jest.fn()
    };

    mockContentIdResolver = {
      resolve: jest.fn().mockReturnValue({
        adapter: mockAdapter,
        localId: '450234',
        source: 'plex'
      })
    };

    const router = createListRouter({
      registry: {},
      contentIdResolver: mockContentIdResolver,
      logger: { info: jest.fn(), warn: jest.fn() }
    });

    app = express();
    app.use('/api/v1/list', router);
  });

  test('wraps playlist as single show container item', async () => {
    // getList returns playlist tracks (normal adapter behavior)
    mockAdapter.getList.mockResolvedValue([
      { id: 'plex:1001', title: 'Track 1', mediaUrl: '/stream/1001', itemType: 'leaf', metadata: { type: 'episode' } },
      { id: 'plex:1002', title: 'Track 2', mediaUrl: '/stream/1002', itemType: 'leaf', metadata: { type: 'episode' } }
    ]);

    // getItem returns playlist metadata
    mockAdapter.getItem.mockResolvedValue({
      id: 'plex:450234',
      title: 'Stretch Playlist',
      thumbnail: '/proxy/plex/composite/450234'
    });

    // getContainerInfo identifies it as a playlist
    mockAdapter.getContainerInfo.mockResolvedValue({
      key: '450234',
      title: 'Stretch Playlist',
      image: '/proxy/plex/composite/450234',
      type: 'playlist',
      playlistType: 'video',
      childCount: 45
    });

    const res = await request(app).get('/api/v1/list/plex/450234');

    expect(res.status).toBe(200);
    // Should return exactly 1 item (the playlist as a container), not 2 tracks
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].type).toBe('show');
    expect(res.body.items[0].itemType).toBe('container');
    expect(res.body.items[0].title).toBe('Stretch Playlist');
    expect(res.body.items[0].id).toBe('plex:450234');
  });

  test('does NOT wrap collections as containers', async () => {
    mockContentIdResolver.resolve.mockReturnValue({
      adapter: mockAdapter,
      localId: '364851',
      source: 'plex'
    });

    mockAdapter.getList.mockResolvedValue([
      { id: 'plex:662027', title: '630', itemType: 'container', metadata: { type: 'show' } },
      { id: 'plex:662028', title: 'HIIT', itemType: 'container', metadata: { type: 'show' } }
    ]);

    mockAdapter.getItem.mockResolvedValue({
      id: 'plex:364851',
      title: 'Stretch Collection',
      thumbnail: '/proxy/plex/thumb/364851'
    });

    mockAdapter.getContainerInfo.mockResolvedValue({
      key: '364851',
      title: 'Stretch Collection',
      type: 'collection',
      childCount: 12
    });

    const res = await request(app).get('/api/v1/list/plex/364851');

    expect(res.status).toBe(200);
    // Should return the 2 shows, NOT a single container
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].type).toBe('show');
  });
});
