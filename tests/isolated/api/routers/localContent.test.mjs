// tests/unit/api/routers/localContent.test.mjs
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createLocalContentRouter } from '#backend/src/4_api/v1/routers/localContent.mjs';

describe('LocalContent API Router', () => {
  let app;
  let mockAdapter;

  beforeEach(() => {
    mockAdapter = {
      name: 'local-content',
      getItem: jest.fn()
    };

    const mockRegistry = {
      get: jest.fn().mockReturnValue(mockAdapter)
    };

    app = express();
    app.use('/api/local-content', createLocalContentRouter({ registry: mockRegistry }));
  });

  describe('GET /api/local-content/scripture/:path', () => {
    it('returns scripture with verses', async () => {
      mockAdapter.getItem.mockResolvedValue({
        id: 'scripture:cfm/1nephi1',
        title: '1 Nephi 1',
        mediaUrl: '/proxy/local-content/stream/scripture/cfm/1nephi1',
        duration: 360,
        metadata: {
          reference: '1 Nephi 1',
          volume: 'bom',
          chapter: 1,
          verses: [{ num: 1, text: 'Test verse', start: 0, end: 15 }]
        }
      });

      const res = await request(app).get('/api/local-content/scripture/cfm/1nephi1');

      expect(res.status).toBe(200);
      expect(res.body.reference).toBe('1 Nephi 1');
      expect(res.body.verses).toHaveLength(1);
      expect(res.body.mediaUrl).toBeDefined();
      expect(res.body.media_key).toBe('scripture:cfm/1nephi1');
    });

    it('returns 404 for nonexistent scripture', async () => {
      mockAdapter.getItem.mockResolvedValue(null);

      const res = await request(app).get('/api/local-content/scripture/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Scripture not found');
    });
  });

  describe('GET /api/local-content/hymn/:number', () => {
    it('returns hymn with lyrics', async () => {
      mockAdapter.getItem.mockResolvedValue({
        id: 'hymn:113',
        title: "Our Savior's Love",
        mediaUrl: '/proxy/local-content/stream/hymn/113',
        duration: 180,
        metadata: {
          number: 113,
          verses: [{ num: 1, lines: ['Test line'] }],
          lyrics: 'Full lyrics...'
        }
      });

      const res = await request(app).get('/api/local-content/hymn/113');

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Our Savior's Love");
      expect(res.body.number).toBe(113);
      expect(res.body.media_key).toBe('hymn:113');
    });

    it('returns 404 for nonexistent hymn', async () => {
      mockAdapter.getItem.mockResolvedValue(null);

      const res = await request(app).get('/api/local-content/hymn/999');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Hymn not found');
    });
  });

  describe('GET /api/local-content/primary/:number', () => {
    it('returns primary song with lyrics', async () => {
      mockAdapter.getItem.mockResolvedValue({
        id: 'primary:42',
        title: 'I Am a Child of God',
        mediaUrl: '/proxy/local-content/stream/primary/42',
        duration: 120,
        metadata: {
          number: 42,
          verses: [{ num: 1, lines: ['I am a child of God'] }],
          lyrics: 'Full lyrics...'
        }
      });

      const res = await request(app).get('/api/local-content/primary/42');

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('I Am a Child of God');
      expect(res.body.number).toBe(42);
    });

    it('returns 404 for nonexistent primary song', async () => {
      mockAdapter.getItem.mockResolvedValue(null);

      const res = await request(app).get('/api/local-content/primary/999');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Primary song not found');
    });
  });

  describe('GET /api/local-content/talk/:path', () => {
    it('returns talk with content', async () => {
      mockAdapter.getItem.mockResolvedValue({
        id: 'talk:general/test-talk',
        title: 'Test Talk',
        mediaUrl: '/proxy/local-content/stream/talk/general/test-talk',
        duration: 1200,
        metadata: {
          speaker: 'Elder Test',
          date: '2024-04-06',
          description: 'A test talk',
          content: [{ type: 'paragraph', text: 'Test content' }]
        }
      });

      const res = await request(app).get('/api/local-content/talk/general/test-talk');

      expect(res.status).toBe(200);
      expect(res.body.speaker).toBe('Elder Test');
      expect(res.body.content).toHaveLength(1);
      expect(res.body.media_key).toBe('talk:general/test-talk');
    });

    it('returns 404 for nonexistent talk', async () => {
      mockAdapter.getItem.mockResolvedValue(null);

      const res = await request(app).get('/api/local-content/talk/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Talk not found');
    });
  });

  describe('GET /api/local-content/poem/:path', () => {
    it('returns poem with stanzas', async () => {
      mockAdapter.getItem.mockResolvedValue({
        id: 'poem:remedy/01',
        title: 'Test Poem',
        mediaUrl: '/proxy/local-content/stream/poem/remedy/01',
        duration: 120,
        metadata: {
          author: 'Test Author',
          condition: 'sleep',
          also_suitable_for: ['calm', 'peace'],
          poem_id: 'remedy/01',
          verses: [{ stanza: 1, lines: ['Test line'] }]
        }
      });

      const res = await request(app).get('/api/local-content/poem/remedy/01');

      expect(res.status).toBe(200);
      expect(res.body.author).toBe('Test Author');
      expect(res.body.condition).toBe('sleep');
      expect(res.body.also_suitable_for).toEqual(['calm', 'peace']);
      expect(res.body.media_key).toBe('poem:remedy/01');
    });

    it('returns 404 for nonexistent poem', async () => {
      mockAdapter.getItem.mockResolvedValue(null);

      const res = await request(app).get('/api/local-content/poem/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Poem not found');
    });
  });

  describe('error handling', () => {
    it('returns 500 when adapter not configured', async () => {
      const mockRegistry = {
        get: jest.fn().mockReturnValue(null)
      };

      const errorApp = express();
      errorApp.use('/api/local-content', createLocalContentRouter({ registry: mockRegistry }));

      const res = await request(errorApp).get('/api/local-content/scripture/test');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('LocalContent adapter not configured');
    });
  });
});
