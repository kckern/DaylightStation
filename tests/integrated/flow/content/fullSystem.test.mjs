// tests/integration/content-domain/fullSystem.test.mjs
// This flow never reads audio metadata. Keep Jest's CommonJS resolver from
// trying to require music-metadata's import-only package export while loading
// the concrete local-content adapter.
import { jest } from '@jest/globals';
jest.unstable_mockModule('music-metadata', () => ({ parseFile: jest.fn() }));

import express from 'express';
import request from 'supertest';
import path from 'path';
import { YamlMediaProgressMemory } from '#adapters/persistence/yaml/YamlMediaProgressMemory.mjs';
import { ContentSourceRegistry } from '#adapters/content/ContentSourceRegistry.mjs';
import { ScriptureResolver } from '#adapters/content/readalong/resolvers/scripture.mjs';

const fixturesPath = path.resolve(process.cwd(), 'tests/_fixtures');

describe('Content Domain Integration', () => {
  let app;
  let registry;

  beforeAll(async () => {
    const { createApiRouters } = await import('#composition/modules/contentApi.mjs');
    const { LocalContentAdapter } = await import('#adapters/content/local-content/LocalContentAdapter.mjs');
    const mediaProgressMemory = new YamlMediaProgressMemory({
      basePath: path.join(fixturesPath, 'watch-state')
    });
    registry = new ContentSourceRegistry();
    registry.register(new LocalContentAdapter({
      dataPath: path.join(fixturesPath, 'local-content'),
      mediaPath: path.join(fixturesPath, 'media'),
      mediaProgressMemory,
      contentRegistry: registry,
      scriptureResolver: ScriptureResolver,
    }), { category: 'local', provider: 'local-content' });

    const { routers } = createApiRouters({
      registry,
      mediaProgressMemory,
      menuMemoryRepository: { load: () => ({}), save: () => undefined },
      dataPath: path.join(fixturesPath, 'local-content'),
      mediaBasePath: path.join(fixturesPath, 'media'),
      configService: { getAppConfig: () => ({}) },
    });

    app = express();
    app.use(express.json());

    // Mount new routers
    app.use('/api/content', routers.content);
    app.use('/api/play', routers.play);
    app.use('/api/list', routers.list);
    app.use('/api/local-content', routers.localContent);
    app.use('/proxy', routers.proxy);
  });

  describe('Adapter Registration', () => {
    it('registers local-content adapter', () => {
      expect(registry.get('local-content')).toBeDefined();
    });
  });

  describe('LocalContent API', () => {
    it('fetches scripture content', async () => {
      const res = await request(app).get('/api/local-content/scripture/cfm/test-chapter');
      expect(res.status).toBe(200);
      expect(res.body.reference).toBe('1 Nephi 1');
      expect(res.body.verses).toBeDefined();
    });

    it('fetches hymn content', async () => {
      const res = await request(app).get('/api/local-content/hymn/113');
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Our Savior's Love");
      expect(res.body.number).toBe(113);
    });

    it('fetches poem content', async () => {
      const res = await request(app).get('/api/local-content/poem/remedy/01');
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Test Poem');
      expect(res.body.author).toBe('Test Author');
    });

    it('fetches talk content', async () => {
      const res = await request(app).get('/api/local-content/talk/general/test-talk');
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Test Talk Title');
    });

    it('returns 404 for missing content', async () => {
      const res = await request(app).get('/api/local-content/scripture/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('Content API', () => {
    it('lists items from local-content', async () => {
      const res = await request(app).get('/api/content/item/local-content/talk:general/test-talk');
      expect(res.status).toBe(200);
    });
  });

  describe('Proxy API', () => {
    it('returns 404 for missing media file', async () => {
      const res = await request(app).get('/proxy/local-content/stream/talk/nonexistent');
      expect(res.status).toBe(404);
    });

    it('returns 400 for unknown content type', async () => {
      const res = await request(app).get('/proxy/local-content/stream/unknown/test');
      expect(res.status).toBe(400);
    });
  });
});
