// tests/unit/api/routers/list.test.mjs
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createListRouter, toListItem } from '#backend/src/4_api/v1/routers/list.mjs';

describe('List API Router', () => {
  let app;
  let mockRegistry;
  let mockFolderAdapter;
  let mockPlexAdapter;

  beforeEach(() => {
    mockFolderAdapter = {
      name: 'folder',
      getList: jest.fn().mockResolvedValue({
        id: 'folder:Morning Program',
        title: 'Morning Program',
        children: [
          { id: 'plex:12345', title: 'Show One', itemType: 'container' },
          { id: 'talk:general/talk1', title: 'Talk One', itemType: 'leaf' }
        ]
      }),
      getItem: jest.fn().mockResolvedValue({
        id: 'folder:Morning Program',
        title: 'Morning Program',
        metadata: { itemCount: 2 }
      }),
      resolvePlayables: jest.fn().mockResolvedValue([
        { id: 'plex:12345', title: 'Show One', mediaUrl: '/proxy/plex/stream/12345' },
        { id: 'talk:general/talk1', title: 'Talk One', mediaUrl: '/proxy/local-content/stream/talk/general/talk1' }
      ])
    };

    mockPlexAdapter = {
      name: 'plex',
      getList: jest.fn().mockResolvedValue([
        { id: 'plex:12345', title: 'Episode 1', itemType: 'leaf' },
        { id: 'plex:12346', title: 'Episode 2', itemType: 'leaf' }
      ]),
      getItem: jest.fn().mockResolvedValue({
        id: 'plex:12345',
        title: 'TV Show',
        thumbnail: '/proxy/plex/thumb/12345'
      }),
      resolvePlayables: jest.fn().mockResolvedValue([
        { id: 'plex:12345', title: 'Episode 1', mediaUrl: '/proxy/plex/stream/12345' },
        { id: 'plex:12346', title: 'Episode 2', mediaUrl: '/proxy/plex/stream/12346' }
      ])
    };

    mockRegistry = {
      get: jest.fn((name) => {
        if (name === 'folder') return mockFolderAdapter;
        if (name === 'plex') return mockPlexAdapter;
        return null;
      })
    };

    app = express();
    app.use('/api/list', createListRouter({ registry: mockRegistry }));
  });

  describe('GET /api/list/:source/*', () => {
    it('returns folder contents', async () => {
      const res = await request(app).get('/api/list/folder/Morning%20Program');

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Morning Program');
      expect(res.body.items).toHaveLength(2);
    });

    it('returns plex container contents', async () => {
      const res = await request(app).get('/api/list/plex/12345');

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
    });

    it('handles playable modifier', async () => {
      const res = await request(app).get('/api/list/plex/12345/playable');

      expect(res.status).toBe(200);
      expect(mockPlexAdapter.resolvePlayables).toHaveBeenCalled();
    });

    it('handles shuffle modifier', async () => {
      const res = await request(app).get('/api/list/plex/12345/shuffle');

      expect(res.status).toBe(200);
    });

    it('handles combined playable,shuffle modifiers', async () => {
      const res = await request(app).get('/api/list/plex/12345/playable,shuffle');

      expect(res.status).toBe(200);
      expect(mockPlexAdapter.resolvePlayables).toHaveBeenCalled();
    });

    it('returns 404 for unknown source', async () => {
      const res = await request(app).get('/api/list/unknown/12345');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Unknown source');
    });

    it('returns empty items array for nonexistent container', async () => {
      mockPlexAdapter.getList.mockResolvedValueOnce([]);
      const res = await request(app).get('/api/list/plex/nonexistent');

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });

    it('includes image from container info', async () => {
      const res = await request(app).get('/api/list/plex/12345');

      expect(res.status).toBe(200);
      expect(res.body.image).toBe('/proxy/plex/thumb/12345');
    });
  });

  describe('toListItem field flattening', () => {
    it('should include action properties at top level', () => {
      const item = {
        id: 'plex:123',
        title: 'Test',
        actions: { play: { plex: '123' }, queue: { playlist: 'plex:123' } }
      };
      const result = toListItem(item);
      // Note: numeric strings are converted to numbers by compactItem
      expect(result.play).toEqual({ plex: 123 });
      expect(result.queue).toEqual({ playlist: 'plex:123' });
    });

    it('should prefer item.actions over computed defaults', () => {
      const item = {
        id: 'plex:123',
        title: 'Test',
        mediaUrl: '/media/test.mp4', // would normally create { media: 'plex:123' }
        itemType: 'container', // would normally create { playlist: 'plex:123' }
        actions: { play: { custom: 'action' }, queue: { custom: 'queue' } }
      };
      const result = toListItem(item);
      expect(result.play).toEqual({ custom: 'action' });
      expect(result.queue).toEqual({ custom: 'queue' });
    });

    it('should include label property from top-level item', () => {
      const item = {
        id: 'test:1',
        title: 'Full Title',
        label: 'Short'
      };
      const result = toListItem(item);
      expect(result.label).toBe('Short');
    });

    it('should prefer top-level label over metadata.label', () => {
      const item = {
        id: 'test:1',
        title: 'Full Title',
        label: 'Top Level',
        metadata: { label: 'Metadata Level' }
      };
      const result = toListItem(item);
      expect(result.label).toBe('Top Level');
    });

    it('should NOT include top-level plex and media_key (they belong in action objects)', () => {
      // plex and media_key are intentionally NOT copied to top level
      // They should be accessed via action objects (play.plex, queue.plex, list.plex)
      const item = {
        id: 'plex:123',
        title: 'Test',
        plex: '123',
        media_key: 'plex:123'
      };
      const result = toListItem(item);
      expect(result.plex).toBeUndefined();
      expect(result.media_key).toBeUndefined();
    });

    it('should NOT extract plex from metadata to top level', () => {
      // plex in metadata should NOT be copied to top level
      // Frontend should access via action objects instead
      const item = {
        id: 'plex:123',
        title: 'Test',
        metadata: { plex: 'metadata-plex' }
      };
      const result = toListItem(item);
      expect(result.plex).toBeUndefined();
    });

    it('should include watch state fields from PlayableItem', () => {
      const item = {
        id: 'plex:123',
        title: 'Test',
        watchProgress: 45,
        watchSeconds: 1350,
        lastPlayed: '2025-01-10T14:30:00Z',
        playCount: 3
      };
      const result = toListItem(item);
      expect(result.watchProgress).toBe(45);
      expect(result.watchSeconds).toBe(1350);
      expect(result.lastPlayed).toBe('2025-01-10T14:30:00Z');
      expect(result.playCount).toBe(3);
    });

    it('should include behavior flags from Item', () => {
      const item = {
        id: 'folder:playlist',
        title: 'Test Playlist',
        shuffle: true,
        continuous: true,
        resume: false,
        active: true
      };
      const result = toListItem(item);
      expect(result.shuffle).toBe(true);
      expect(result.continuous).toBe(true);
      // Note: falsy values (including false) are filtered by compactItem
      expect(result.resume).toBeUndefined();
      expect(result.active).toBe(true);
    });

    it('should include list and open actions', () => {
      const item = {
        id: 'plex:show123',
        title: 'TV Show',
        actions: {
          list: { path: '/api/list/plex/show123' },
          open: { url: '/tv/plex/show123' }
        }
      };
      const result = toListItem(item);
      expect(result.list).toEqual({ path: '/api/list/plex/show123' });
      expect(result.open).toEqual({ url: '/tv/plex/show123' });
    });
  });
});
