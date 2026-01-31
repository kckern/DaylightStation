// tests/integrated/api/content/compose.test.mjs
/**
 * Compose API Integration Tests
 *
 * Tests the POST /api/content/compose endpoint for multi-track
 * presentation composition.
 *
 * Note: These tests use a minimal mock setup to test the compose
 * endpoint in isolation without depending on the full content router.
 */

import express from 'express';
import request from 'supertest';
import { ComposePresentationUseCase } from '#apps/content/usecases/ComposePresentationUseCase.mjs';

/**
 * Mock content source registry that mimics the ContentSourceRegistry interface.
 * Stores adapters by name and provides get/list methods.
 */
class MockRegistry {
  constructor() {
    this.adapters = new Map();
  }

  register(adapter) {
    this.adapters.set(adapter.source, adapter);
  }

  get(sourceName) {
    return this.adapters.get(sourceName) || null;
  }

  getAdapter(sourceName) {
    return this.get(sourceName);
  }

  list() {
    return Array.from(this.adapters.keys());
  }
}

/**
 * Mock content adapter for testing composition.
 * Provides items with known properties for predictable test outcomes.
 */
class MockContentAdapter {
  constructor(name) {
    this._name = name;
    this.items = new Map();
  }

  get source() {
    return this._name;
  }

  get prefixes() {
    return [{ prefix: this._name }];
  }

  addItem(id, item) {
    this.items.set(id, item);
  }

  async getItem(id) {
    const localId = id.startsWith(`${this._name}:`) ? id.slice(this._name.length + 1) : id;
    return this.items.get(localId) || null;
  }

  async getList() {
    return Array.from(this.items.values());
  }

  async resolvePlayables(id) {
    const item = await this.getItem(id);
    return item ? [item] : [];
  }
}

/**
 * Create a minimal Express app that only mounts the compose endpoint.
 * This avoids issues with the full content router's wildcard paths.
 */
function createComposeTestApp(composePresentationUseCase) {
  const app = express();
  app.use(express.json());

  // Mount only the compose endpoint
  app.post('/api/content/compose', async (req, res) => {
    if (!composePresentationUseCase) {
      return res.status(501).json({
        error: 'Compose endpoint not configured',
        code: 'COMPOSE_NOT_CONFIGURED'
      });
    }

    const { sources, config = {} } = req.body;

    // Validate sources is non-empty array
    if (!sources || !Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({
        error: 'sources must be a non-empty array of source identifiers',
        code: 'INVALID_SOURCES'
      });
    }

    try {
      const presentation = await composePresentationUseCase.compose(sources, config);
      res.json(presentation);
    } catch (err) {
      // Handle application errors with appropriate status codes
      if (err.code === 'INVALID_INPUT' || err.code === 'NO_VISUAL_TRACK') {
        return res.status(400).json({
          error: err.message,
          code: err.code,
          details: err.details
        });
      }
      if (err.code === 'ITEM_NOT_FOUND' || err.name === 'ServiceNotFoundError') {
        return res.status(404).json({
          error: err.message,
          code: err.code || 'NOT_FOUND',
          details: err.details
        });
      }
      // Return 500 for unexpected errors
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

describe('Compose API Router', () => {
  let app;
  let registry;
  let mockPlex;
  let composePresentationUseCase;

  beforeAll(() => {
    registry = new MockRegistry();

    // Create mock Plex adapter with test items
    mockPlex = new MockContentAdapter('plex');

    // Add video item
    mockPlex.addItem('12345', {
      id: 'plex:12345',
      title: 'Test Video',
      mediaType: 'video',
      duration: 3600, // 1 hour in seconds
      mediaUrl: 'http://localhost/video/12345.mp4',
      thumbnail: 'http://localhost/thumb/12345.jpg'
    });

    // Add audio item
    mockPlex.addItem('67890', {
      id: 'plex:67890',
      title: 'Test Audio Track',
      mediaType: 'audio',
      duration: 240, // 4 minutes
      mediaUrl: 'http://localhost/audio/67890.mp3'
    });

    // Add another video for multi-visual tests
    mockPlex.addItem('11111', {
      id: 'plex:11111',
      title: 'Second Video',
      mediaType: 'video',
      duration: 1800,
      mediaUrl: 'http://localhost/video/11111.mp4',
      thumbnail: 'http://localhost/thumb/11111.jpg'
    });

    // Add image item
    mockPlex.addItem('22222', {
      id: 'plex:22222',
      title: 'Test Image',
      mediaType: 'image',
      thumbnail: 'http://localhost/img/22222.jpg'
    });

    registry.register(mockPlex);

    // Create use case with mock registry
    composePresentationUseCase = new ComposePresentationUseCase({
      contentSourceRegistry: registry,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    });

    app = createComposeTestApp(composePresentationUseCase);
  });

  // ===========================================================================
  // SUCCESSFUL COMPOSITION
  // ===========================================================================
  describe('POST /api/content/compose - successful composition', () => {
    test('composes single video source', async () => {
      const res = await request(app)
        .post('/api/content/compose')
        .send({
          sources: ['plex:12345']
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('visual');
      expect(res.body).toHaveProperty('layout');
      expect(res.body.visual.items).toHaveLength(1);
      expect(res.body.visual.items[0].id).toBe('plex:12345');
    });

    test('composes video with audio overlay', async () => {
      const res = await request(app)
        .post('/api/content/compose')
        .send({
          sources: ['plex:12345', 'audio:plex:67890']
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('visual');
      expect(res.body).toHaveProperty('audio');
      expect(res.body.visual.items[0].id).toBe('plex:12345');
      expect(res.body.audio.items[0].id).toBe('plex:67890');
    });

    test('infers track from mediaType when not explicit', async () => {
      const res = await request(app)
        .post('/api/content/compose')
        .send({
          sources: ['plex:12345', 'plex:67890']
        });

      expect(res.status).toBe(200);
      // Video should be visual track
      expect(res.body.visual.items[0].id).toBe('plex:12345');
      // Audio should be audio track
      expect(res.body.audio.items[0].id).toBe('plex:67890');
    });

    test('accepts numeric-only source as plex', async () => {
      const res = await request(app)
        .post('/api/content/compose')
        .send({
          sources: ['12345']
        });

      expect(res.status).toBe(200);
      expect(res.body.visual.items[0].id).toBe('plex:12345');
    });

    test('applies config options', async () => {
      const res = await request(app)
        .post('/api/content/compose')
        .send({
          sources: ['plex:12345'],
          config: {
            advance: { mode: 'timed', interval: 5000 },
            loop: true,
            layout: 'fullscreen'
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.layout).toBe('fullscreen');
      expect(res.body.visual.advance).toEqual({ mode: 'timed', interval: 5000 });
      expect(res.body.visual.loop).toBe(true);
    });

    test('composes image source as visual', async () => {
      const res = await request(app)
        .post('/api/content/compose')
        .send({
          sources: ['plex:22222']
        });

      expect(res.status).toBe(200);
      expect(res.body.visual.items[0].id).toBe('plex:22222');
    });
  });

  // ===========================================================================
  // VALIDATION ERRORS
  // ===========================================================================
  describe('POST /api/content/compose - validation errors', () => {
    test('returns 400 for missing sources', async () => {
      const res = await request(app)
        .post('/api/content/compose')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('sources');
      expect(res.body.code).toBe('INVALID_SOURCES');
    });

    test('returns 400 for empty sources array', async () => {
      const res = await request(app)
        .post('/api/content/compose')
        .send({ sources: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('sources');
      expect(res.body.code).toBe('INVALID_SOURCES');
    });

    test('returns 400 for non-array sources', async () => {
      const res = await request(app)
        .post('/api/content/compose')
        .send({ sources: 'plex:12345' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_SOURCES');
    });

    test('returns 400 for audio-only composition (no visual)', async () => {
      const res = await request(app)
        .post('/api/content/compose')
        .send({
          sources: ['audio:plex:67890']
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('NO_VISUAL_TRACK');
    });

    test('returns 404 for non-existent item', async () => {
      const res = await request(app)
        .post('/api/content/compose')
        .send({
          sources: ['plex:99999']
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ITEM_NOT_FOUND');
    });

    test('returns 404 for unknown source provider', async () => {
      const res = await request(app)
        .post('/api/content/compose')
        .send({
          sources: ['unknownsource:12345']
        });

      expect(res.status).toBe(404);
    });
  });

  // ===========================================================================
  // ENDPOINT NOT CONFIGURED
  // ===========================================================================
  describe('POST /api/content/compose - endpoint not configured', () => {
    test('returns 501 when use case not provided', async () => {
      // Create app without composePresentationUseCase
      const app2 = createComposeTestApp(null);

      const res = await request(app2)
        .post('/api/content/compose')
        .send({ sources: ['plex:12345'] });

      expect(res.status).toBe(501);
      expect(res.body.code).toBe('COMPOSE_NOT_CONFIGURED');
    });
  });

  // ===========================================================================
  // RESPONSE FORMAT
  // ===========================================================================
  describe('POST /api/content/compose - response format', () => {
    test('returns IComposedPresentation structure', async () => {
      const res = await request(app)
        .post('/api/content/compose')
        .send({
          sources: ['plex:12345', 'audio:plex:67890'],
          config: { layout: 'pip' }
        });

      expect(res.status).toBe(200);

      // Check visual track structure
      expect(res.body.visual).toHaveProperty('items');
      expect(res.body.visual).toHaveProperty('advance');
      expect(res.body.visual).toHaveProperty('loop');

      // Check audio track structure
      expect(res.body.audio).toHaveProperty('items');
      expect(res.body.audio).toHaveProperty('shuffle');
      expect(res.body.audio).toHaveProperty('loop');

      // Check layout
      expect(res.body.layout).toBe('pip');
    });

    test('visual items have expected properties', async () => {
      const res = await request(app)
        .post('/api/content/compose')
        .send({ sources: ['plex:12345'] });

      expect(res.status).toBe(200);
      const item = res.body.visual.items[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('url');
    });

    test('includes modifiers in response', async () => {
      const res = await request(app)
        .post('/api/content/compose')
        .send({
          sources: ['plex:12345'],
          config: {
            shader: 'crt',
            playbackRate: 1.5,
            continuous: true
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.modifiers).toBeDefined();
      expect(res.body.modifiers.shader).toBe('crt');
      expect(res.body.modifiers.playbackRate).toBe(1.5);
      expect(res.body.modifiers.continuous).toBe(true);
    });
  });
});
