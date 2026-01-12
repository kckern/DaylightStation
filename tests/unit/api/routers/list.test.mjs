// tests/unit/api/routers/list.test.mjs
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createListRouter } from '../../../../backend/src/4_api/routers/list.mjs';

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
});
