import { describe, test, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createListRouter } from '#backend/src/4_api/v1/routers/list.mjs';

/**
 * Test that the list router wraps seasons as single container items.
 * When /api/v1/list/plex/{seasonId} is called and the ID is a Plex season,
 * the response should contain a single "show" container item with
 * sourceType:'season' (not the season's individual episodes), so it appears
 * as a single tile in FitnessMenu alongside collection shows and playlists.
 */
describe('list router season-as-show', () => {
  let app;
  let mockAdapter;
  let mockContentIdResolver;

  beforeEach(() => {
    mockAdapter = {
      getList: vi.fn(),
      getItem: vi.fn(),
      getContainerInfo: vi.fn()
    };

    mockContentIdResolver = {
      resolve: vi.fn().mockReturnValue({
        adapter: mockAdapter,
        localId: '603856',
        source: 'plex'
      })
    };

    const router = createListRouter({
      registry: {},
      contentIdResolver: mockContentIdResolver,
      logger: { info: vi.fn(), warn: vi.fn() }
    });

    app = express();
    app.use('/api/v1/list', router);
  });

  test('wraps season as single show container item with sourceType=season', async () => {
    // getList returns the season's episodes (normal adapter behavior for a season ID)
    mockAdapter.getList.mockResolvedValue([
      { id: 'plex:1001', title: 'Day 1', mediaUrl: '/stream/1001', itemType: 'leaf', metadata: { type: 'episode' } },
      { id: 'plex:1002', title: 'Day 2', mediaUrl: '/stream/1002', itemType: 'leaf', metadata: { type: 'episode' } }
    ]);

    mockAdapter.getItem.mockResolvedValue({
      id: 'plex:603856',
      title: 'LIIFT MORE Super Block',
      thumbnail: '/proxy/plex/library/metadata/603856/thumb/1'
    });

    mockAdapter.getContainerInfo.mockResolvedValue({
      key: '603856',
      title: 'LIIFT MORE Super Block',
      image: '/proxy/plex/library/metadata/603856/thumb/1',
      type: 'season',
      childCount: 22,
      rating: 9,
      userRating: 9,
      parentRatingKey: '603855',
      parentTitle: 'Super Blocks',
      labels: []
    });

    const res = await request(app).get('/api/v1/list/plex/603856');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const tile = res.body.items[0];
    expect(tile.id).toBe('plex:603856');
    expect(tile.title).toBe('LIIFT MORE Super Block');
    expect(tile.itemType).toBe('container');
    expect(tile.type).toBe('show');
    // metadata is stripped by compactItem (fields are flattened to top-level);
    // sourceType is accessible directly on the tile, not via tile.metadata
    expect(tile.sourceType).toBe('season');
  });

  test('passes rating through to tile metadata for menu sorting', async () => {
    // Per PlexAdapter convention (lines 509 and 623), `info.rating` from
    // getContainerInfo is already the best-available rating
    // (item.userRating ?? item.rating ?? item.audienceRating). The list
    // router does NOT compose — it just passes `info.rating` through.
    // FitnessMenu then sorts by tile.rating directly.
    mockAdapter.getList.mockResolvedValue([]);
    mockAdapter.getItem.mockResolvedValue({ id: 'plex:603856', title: 'LIIFT MORE Super Block' });
    mockAdapter.getContainerInfo.mockResolvedValue({
      key: '603856',
      title: 'LIIFT MORE Super Block',
      type: 'season',
      childCount: 22,
      rating: 9,            // already the best-available rating from getContainerInfo
      userRating: 9,        // raw user rating, exposed separately for diagnostics
      parentRatingKey: '603855'
    });

    const res = await request(app).get('/api/v1/list/plex/603856');

    expect(res.status).toBe(200);
    const tile = res.body.items[0];
    expect(tile.rating).toBe(9);          // passed through from info.rating
    expect(tile.userRating).toBe(9);
  });

  test('uses season image as tile thumbnail', async () => {
    mockAdapter.getList.mockResolvedValue([]);
    mockAdapter.getItem.mockResolvedValue({ id: 'plex:603856', title: 'LIIFT MORE Super Block' });
    mockAdapter.getContainerInfo.mockResolvedValue({
      key: '603856',
      title: 'LIIFT MORE Super Block',
      image: '/proxy/plex/library/metadata/603856/thumb/1',
      type: 'season',
      childCount: 22,
      rating: 9
    });

    const res = await request(app).get('/api/v1/list/plex/603856');

    expect(res.status).toBe(200);
    const tile = res.body.items[0];
    expect(tile.thumbnail).toBe('/proxy/plex/library/metadata/603856/thumb/1');
  });

  test('absent rating falls through to null without crashing', async () => {
    mockAdapter.getList.mockResolvedValue([]);
    mockAdapter.getItem.mockResolvedValue({ id: 'plex:603856', title: 'Unrated Season' });
    mockAdapter.getContainerInfo.mockResolvedValue({
      key: '603856',
      title: 'Unrated Season',
      type: 'season',
      childCount: 5
      // no rating field
    });

    const res = await request(app).get('/api/v1/list/plex/603856');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const tile = res.body.items[0];
    // null/undefined rating is acceptable; the existing FitnessMenu sort
    // uses (b.rating || 0) so unrated tiles sink to the bottom.
    expect(tile.rating == null).toBe(true);
  });
});
