// tests/unit/api/routers/info.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Must import from the future file path
import { createInfoRouter } from '#api/v1/routers/info.mjs';

describe('Info Router', () => {
  let app;
  let mockRegistry;
  let mockAdapter;
  let mockLogger;

  beforeEach(() => {
    // Create mock adapter
    mockAdapter = {
      getItem: vi.fn()
    };

    // Create mock registry
    mockRegistry = {
      get: vi.fn()
    };

    // Create mock logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    // Create Express app with the router
    app = express();
    app.use('/info', createInfoRouter({
      registry: mockRegistry,
      logger: mockLogger
    }));
  });

  describe('GET /info/:source/*', () => {
    describe('Path segment format: /info/plex/12345', () => {
      it('should return metadata for a valid item', async () => {
        const mockItem = {
          id: 'plex:12345',
          title: 'Test Episode',
          type: 'episode',
          mediaUrl: '/stream/plex/12345',
          thumbnail: '/image/plex/12345',
          metadata: {
            duration: 1800,
            grandparentTitle: 'Test Show'
          }
        };

        mockRegistry.get.mockReturnValue(mockAdapter);
        mockAdapter.getItem.mockResolvedValue(mockItem);

        const response = await request(app)
          .get('/info/plex/12345')
          .expect(200);

        expect(response.body.id).toBe('plex:12345');
        expect(response.body.source).toBe('plex');
        expect(response.body.type).toBe('episode');
        expect(response.body.title).toBe('Test Episode');
        expect(response.body.capabilities).toContain('playable');
        expect(response.body.capabilities).toContain('displayable');
        expect(response.body.metadata).toEqual({
          duration: 1800,
          grandparentTitle: 'Test Show'
        });

        expect(mockRegistry.get).toHaveBeenCalledWith('plex');
        expect(mockAdapter.getItem).toHaveBeenCalledWith('plex:12345');
      });

      it('should handle nested path segments for folder source', async () => {
        const mockItem = {
          id: 'folder:watchlist/FHE',
          title: 'FHE Folder',
          type: 'container',
          items: [{ id: '1' }, { id: '2' }],
          thumbnail: '/image/folder/watchlist/FHE'
        };

        mockRegistry.get.mockReturnValue(mockAdapter);
        mockAdapter.getItem.mockResolvedValue(mockItem);

        const response = await request(app)
          .get('/info/folder/watchlist/FHE')
          .expect(200);

        expect(response.body.id).toBe('folder:watchlist/FHE');
        expect(response.body.source).toBe('folder');
        expect(response.body.capabilities).toContain('listable');
        expect(response.body.capabilities).toContain('displayable');

        expect(mockAdapter.getItem).toHaveBeenCalledWith('folder:watchlist/FHE');
      });
    });

    describe('Compound ID format: /info/plex:12345', () => {
      it('should parse compound ID correctly', async () => {
        const mockItem = {
          id: 'plex:12345',
          title: 'Test Movie',
          type: 'movie',
          mediaUrl: '/stream/plex/12345'
        };

        mockRegistry.get.mockReturnValue(mockAdapter);
        mockAdapter.getItem.mockResolvedValue(mockItem);

        const response = await request(app)
          .get('/info/plex:12345')
          .expect(200);

        expect(response.body.id).toBe('plex:12345');
        expect(response.body.source).toBe('plex');
        expect(response.body.capabilities).toContain('playable');

        expect(mockRegistry.get).toHaveBeenCalledWith('plex');
        expect(mockAdapter.getItem).toHaveBeenCalledWith('plex:12345');
      });

      it('should handle compound ID with nested path', async () => {
        const mockItem = {
          id: 'folder:watchlist/movies',
          title: 'Movies Watchlist',
          type: 'container',
          itemType: 'container'
        };

        mockRegistry.get.mockReturnValue(mockAdapter);
        mockAdapter.getItem.mockResolvedValue(mockItem);

        const response = await request(app)
          .get('/info/folder:watchlist/movies')
          .expect(200);

        expect(response.body.id).toBe('folder:watchlist/movies');
        expect(response.body.source).toBe('folder');
        expect(response.body.capabilities).toContain('listable');

        expect(mockAdapter.getItem).toHaveBeenCalledWith('folder:watchlist/movies');
      });
    });

    describe('Heuristic detection: /info/12345', () => {
      it('should detect plex source from bare digits', async () => {
        const mockItem = {
          id: 'plex:12345',
          title: 'Auto-detected Plex Item',
          type: 'episode',
          mediaUrl: '/stream/plex/12345'
        };

        mockRegistry.get.mockReturnValue(mockAdapter);
        mockAdapter.getItem.mockResolvedValue(mockItem);

        const response = await request(app)
          .get('/info/12345')
          .expect(200);

        expect(response.body.id).toBe('plex:12345');
        expect(response.body.source).toBe('plex');

        expect(mockRegistry.get).toHaveBeenCalledWith('plex');
        expect(mockAdapter.getItem).toHaveBeenCalledWith('plex:12345');
      });

      it('should detect immich source from UUID', async () => {
        const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        const mockItem = {
          id: `immich:${uuid}`,
          title: 'Photo',
          type: 'image',
          imageUrl: `/image/immich/${uuid}`
        };

        mockRegistry.get.mockReturnValue(mockAdapter);
        mockAdapter.getItem.mockResolvedValue(mockItem);

        const response = await request(app)
          .get(`/info/${uuid}`)
          .expect(200);

        expect(response.body.id).toBe(`immich:${uuid}`);
        expect(response.body.source).toBe('immich');

        expect(mockRegistry.get).toHaveBeenCalledWith('immich');
      });
    });

    describe('Error handling', () => {
      it('should return 404 for unknown source', async () => {
        mockRegistry.get.mockReturnValue(null);

        const response = await request(app)
          .get('/info/unknownsource/12345')
          .expect(404);

        expect(response.body.error).toContain('Unknown source');
        expect(mockRegistry.get).toHaveBeenCalledWith('unknownsource');
      });

      it('should return 404 when item not found', async () => {
        mockRegistry.get.mockReturnValue(mockAdapter);
        mockAdapter.getItem.mockResolvedValue(null);

        const response = await request(app)
          .get('/info/plex/99999')
          .expect(404);

        expect(response.body.error).toContain('not found');
      });
    });

    describe('Capabilities detection', () => {
      it('should include playable capability when mediaUrl exists', async () => {
        const mockItem = {
          id: 'plex:12345',
          title: 'Video',
          mediaUrl: '/stream/plex/12345'
        };

        mockRegistry.get.mockReturnValue(mockAdapter);
        mockAdapter.getItem.mockResolvedValue(mockItem);

        const response = await request(app)
          .get('/info/plex/12345')
          .expect(200);

        expect(response.body.capabilities).toContain('playable');
      });

      it('should include displayable capability when thumbnail exists', async () => {
        const mockItem = {
          id: 'immich:abc',
          title: 'Photo',
          thumbnail: '/thumb/immich/abc'
        };

        mockRegistry.get.mockReturnValue(mockAdapter);
        mockAdapter.getItem.mockResolvedValue(mockItem);

        const response = await request(app)
          .get('/info/immich/abc')
          .expect(200);

        expect(response.body.capabilities).toContain('displayable');
      });

      it('should include displayable capability when imageUrl exists', async () => {
        const mockItem = {
          id: 'immich:abc',
          title: 'Photo',
          imageUrl: '/full/immich/abc'
        };

        mockRegistry.get.mockReturnValue(mockAdapter);
        mockAdapter.getItem.mockResolvedValue(mockItem);

        const response = await request(app)
          .get('/info/immich/abc')
          .expect(200);

        expect(response.body.capabilities).toContain('displayable');
      });

      it('should include listable capability when items array exists', async () => {
        const mockItem = {
          id: 'folder:watchlist',
          title: 'Watchlist',
          items: [{ id: '1' }, { id: '2' }]
        };

        mockRegistry.get.mockReturnValue(mockAdapter);
        mockAdapter.getItem.mockResolvedValue(mockItem);

        const response = await request(app)
          .get('/info/folder/watchlist')
          .expect(200);

        expect(response.body.capabilities).toContain('listable');
      });

      it('should include listable capability when itemType is container', async () => {
        const mockItem = {
          id: 'plex:99',
          title: 'Library',
          itemType: 'container'
        };

        mockRegistry.get.mockReturnValue(mockAdapter);
        mockAdapter.getItem.mockResolvedValue(mockItem);

        const response = await request(app)
          .get('/info/plex/99')
          .expect(200);

        expect(response.body.capabilities).toContain('listable');
      });

      it('should include readable capability when contentUrl exists', async () => {
        const mockItem = {
          id: 'komga:book123',
          title: 'Comic Book',
          contentUrl: '/read/komga/book123'
        };

        mockRegistry.get.mockReturnValue(mockAdapter);
        mockAdapter.getItem.mockResolvedValue(mockItem);

        const response = await request(app)
          .get('/info/komga/book123')
          .expect(200);

        expect(response.body.capabilities).toContain('readable');
      });

      it('should include readable capability when format exists', async () => {
        const mockItem = {
          id: 'komga:book456',
          title: 'PDF Document',
          format: 'pdf'
        };

        mockRegistry.get.mockReturnValue(mockAdapter);
        mockAdapter.getItem.mockResolvedValue(mockItem);

        const response = await request(app)
          .get('/info/komga/book456')
          .expect(200);

        expect(response.body.capabilities).toContain('readable');
      });

      it('should return empty capabilities for minimal item', async () => {
        const mockItem = {
          id: 'plex:12345',
          title: 'Minimal Item'
        };

        mockRegistry.get.mockReturnValue(mockAdapter);
        mockAdapter.getItem.mockResolvedValue(mockItem);

        const response = await request(app)
          .get('/info/plex/12345')
          .expect(200);

        expect(response.body.capabilities).toEqual([]);
      });
    });

    describe('Source alias normalization', () => {
      it('should normalize local to folder', async () => {
        const mockItem = {
          id: 'folder:watchlist',
          title: 'Watchlist',
          type: 'container'
        };

        mockRegistry.get.mockReturnValue(mockAdapter);
        mockAdapter.getItem.mockResolvedValue(mockItem);

        const response = await request(app)
          .get('/info/local/watchlist')
          .expect(200);

        expect(response.body.source).toBe('folder');
        expect(mockRegistry.get).toHaveBeenCalledWith('folder');
      });
    });
  });

  describe('Router factory', () => {
    it('should create a router with required dependencies', () => {
      const router = createInfoRouter({
        registry: mockRegistry,
        logger: mockLogger
      });

      expect(router).toBeDefined();
      expect(typeof router.get).toBe('function');
    });

    it('should use default logger if not provided', () => {
      const router = createInfoRouter({
        registry: mockRegistry
      });

      expect(router).toBeDefined();
    });
  });
});
