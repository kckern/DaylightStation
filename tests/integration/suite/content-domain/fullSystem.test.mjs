// tests/integration/content-domain/fullSystem.test.mjs
import express from 'express';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createContentRegistry,
  createWatchStore,
  createApiRouters
} from '@backend/src/0_infrastructure/bootstrap.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.resolve(__dirname, '../../_fixtures');

describe('Content Domain Integration', () => {
  let app;
  let registry;

  beforeAll(async () => {
    registry = createContentRegistry({
      mediaBasePath: path.join(fixturesPath, 'media'),
      dataPath: path.join(fixturesPath, 'local-content')
    });

    const watchStore = createWatchStore({
      watchStatePath: path.join(fixturesPath, 'watch-state')
    });

    const routers = createApiRouters({ registry, watchStore });

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
