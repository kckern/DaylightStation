import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createMediaRouter } from '#backend/src/4_api/v1/routers/media.mjs';

/**
 * Isolated tests for the Media Queue Router.
 *
 * All dependencies (mediaQueueService, broadcastEvent, etc.) are mocked.
 * We mount the router on a throw-away Express app and exercise every endpoint.
 */
describe('Media Queue Router', () => {
  let app;
  let mockMediaQueueService;
  let mockBroadcastEvent;
  let mockContentIdResolver;
  let mockLogger;

  /** A reusable queue-shaped object returned by mocked service methods. */
  const fakeQueue = {
    toJSON() {
      return {
        position: 0,
        shuffle: false,
        repeat: 'off',
        volume: 1.0,
        items: [
          { queueId: 'abc1', contentId: 'plex:100', title: 'Song A' },
          { queueId: 'abc2', contentId: 'plex:200', title: 'Song B' },
        ],
        shuffleOrder: [],
      };
    },
  };

  beforeEach(() => {
    mockMediaQueueService = {
      load: jest.fn().mockResolvedValue(fakeQueue),
      replace: jest.fn().mockResolvedValue(undefined),
      addItems: jest.fn().mockResolvedValue([
        { queueId: 'new1', contentId: 'plex:300', title: 'Song C' },
      ]),
      removeItem: jest.fn().mockResolvedValue(fakeQueue),
      reorder: jest.fn().mockResolvedValue(fakeQueue),
      setPosition: jest.fn().mockResolvedValue(fakeQueue),
      updateState: jest.fn().mockResolvedValue(fakeQueue),
      clear: jest.fn().mockResolvedValue(fakeQueue),
      advance: jest.fn().mockResolvedValue(fakeQueue),
    };

    mockBroadcastEvent = jest.fn();
    mockContentIdResolver = jest.fn();
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    app = express();
    app.use(express.json());

    const router = createMediaRouter({
      mediaQueueService: mockMediaQueueService,
      contentIdResolver: mockContentIdResolver,
      broadcastEvent: mockBroadcastEvent,
      logger: mockLogger,
    });

    app.use('/media', router);
  });

  // ── 1. GET /media/queue ──────────────────────────────────────────
  describe('GET /media/queue', () => {
    it('returns queue JSON with items and position', async () => {
      const res = await request(app).get('/media/queue');

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.position).toBe(0);
      expect(res.body.shuffle).toBe(false);
      expect(mockMediaQueueService.load).toHaveBeenCalled();
    });
  });

  // ── 2-3. POST /media/queue/items ─────────────────────────────────
  describe('POST /media/queue/items', () => {
    it('adds items and returns added + queue', async () => {
      const res = await request(app)
        .post('/media/queue/items')
        .send({
          items: [{ contentId: 'plex:300', title: 'Song C' }],
          mutationId: 'mut-1',
        });

      expect(res.status).toBe(200);
      expect(res.body.added).toHaveLength(1);
      expect(res.body.queue).toBeDefined();
      expect(mockMediaQueueService.addItems).toHaveBeenCalledWith(
        [{ contentId: 'plex:300', title: 'Song C' }],
        'end',
        undefined,
      );
    });

    it('passes placement=next through to service', async () => {
      const res = await request(app)
        .post('/media/queue/items')
        .send({
          items: [{ contentId: 'plex:400' }],
          placement: 'next',
          mutationId: 'mut-2',
        });

      expect(res.status).toBe(200);
      expect(mockMediaQueueService.addItems).toHaveBeenCalledWith(
        [{ contentId: 'plex:400' }],
        'next',
        undefined,
      );
    });

    it('returns 400 when items is not an array', async () => {
      const res = await request(app)
        .post('/media/queue/items')
        .send({ items: 'not-an-array' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  // ── 4. DELETE /media/queue/items/:queueId ────────────────────────
  describe('DELETE /media/queue/items/:queueId', () => {
    it('removes item and returns queue JSON', async () => {
      const res = await request(app)
        .delete('/media/queue/items/abc1')
        .send({ mutationId: 'mut-del' });

      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
      expect(mockMediaQueueService.removeItem).toHaveBeenCalledWith('abc1', undefined);
    });
  });

  // ── 5. PATCH /media/queue/items/reorder ──────────────────────────
  describe('PATCH /media/queue/items/reorder', () => {
    it('calls reorder on the service', async () => {
      const res = await request(app)
        .patch('/media/queue/items/reorder')
        .send({ queueId: 'abc1', toIndex: 1, mutationId: 'mut-reorder' });

      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
      expect(mockMediaQueueService.reorder).toHaveBeenCalledWith('abc1', 1, undefined);
    });
  });

  // ── 6. PATCH /media/queue/position ───────────────────────────────
  describe('PATCH /media/queue/position', () => {
    it('sets position and returns queue JSON', async () => {
      const res = await request(app)
        .patch('/media/queue/position')
        .send({ position: 3, mutationId: 'mut-pos' });

      expect(res.status).toBe(200);
      expect(mockMediaQueueService.setPosition).toHaveBeenCalledWith(3, undefined);
    });

    it('returns 400 when position is missing', async () => {
      const res = await request(app)
        .patch('/media/queue/position')
        .send({ mutationId: 'abc' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/position/i);
      expect(mockMediaQueueService.setPosition).not.toHaveBeenCalled();
    });

    it('returns 400 when position is negative', async () => {
      const res = await request(app)
        .patch('/media/queue/position')
        .send({ position: -1, mutationId: 'abc' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/position/i);
      expect(mockMediaQueueService.setPosition).not.toHaveBeenCalled();
    });

    it('returns 400 when position is a float', async () => {
      const res = await request(app)
        .patch('/media/queue/position')
        .send({ position: 1.5, mutationId: 'abc' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/position/i);
      expect(mockMediaQueueService.setPosition).not.toHaveBeenCalled();
    });

    it('returns 400 when position is not a number', async () => {
      const res = await request(app)
        .patch('/media/queue/position')
        .send({ position: 'first', mutationId: 'abc' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/position/i);
      expect(mockMediaQueueService.setPosition).not.toHaveBeenCalled();
    });

    it('accepts position: 0 as valid', async () => {
      const res = await request(app)
        .patch('/media/queue/position')
        .send({ position: 0, mutationId: 'abc' });
      expect(res.status).toBe(200);
      expect(mockMediaQueueService.setPosition).toHaveBeenCalledWith(0, undefined);
    });
  });

  // ── 7. PATCH /media/queue/state ──────────────────────────────────
  describe('PATCH /media/queue/state', () => {
    it('updates state and returns queue JSON', async () => {
      const res = await request(app)
        .patch('/media/queue/state')
        .send({ shuffle: true, repeat: 'all', volume: 0.5, mutationId: 'mut-state' });

      expect(res.status).toBe(200);
      expect(mockMediaQueueService.updateState).toHaveBeenCalledWith(
        { shuffle: true, repeat: 'all', volume: 0.5 },
        undefined,
      );
    });

    it('only sends defined fields', async () => {
      const res = await request(app)
        .patch('/media/queue/state')
        .send({ volume: 0.8, mutationId: 'mut-vol' });

      expect(res.status).toBe(200);
      expect(mockMediaQueueService.updateState).toHaveBeenCalledWith(
        { volume: 0.8 },
        undefined,
      );
    });
  });

  // ── 8. DELETE /media/queue ───────────────────────────────────────
  describe('DELETE /media/queue', () => {
    it('clears queue and returns queue JSON', async () => {
      const res = await request(app)
        .delete('/media/queue')
        .send({ mutationId: 'mut-clear' });

      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
      expect(mockMediaQueueService.clear).toHaveBeenCalledWith(undefined);
    });
  });

  // ── 9. POST /media/queue/advance ─────────────────────────────────
  describe('POST /media/queue/advance', () => {
    it('calls service.advance(1, { auto: false }) for a manual step-forward', async () => {
      const res = await request(app)
        .post('/media/queue/advance')
        .send({ step: 1, auto: false, mutationId: 'adv-1' });

      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
      expect(mockMediaQueueService.advance).toHaveBeenCalledWith(1, { auto: false }, undefined);
    });

    it('calls service.advance(1, { auto: true }) for end-of-track auto-advance', async () => {
      const res = await request(app)
        .post('/media/queue/advance')
        .send({ step: 1, auto: true, mutationId: 'adv-2' });

      expect(res.status).toBe(200);
      expect(mockMediaQueueService.advance).toHaveBeenCalledWith(1, { auto: true }, undefined);
    });

    it('supports step=-1 for previous', async () => {
      const res = await request(app)
        .post('/media/queue/advance')
        .send({ step: -1, auto: false, mutationId: 'adv-3' });

      expect(res.status).toBe(200);
      expect(mockMediaQueueService.advance).toHaveBeenCalledWith(-1, { auto: false }, undefined);
    });

    it('defaults step to 1 and auto to false when omitted', async () => {
      const res = await request(app)
        .post('/media/queue/advance')
        .send({ mutationId: 'adv-4' });

      expect(res.status).toBe(200);
      expect(mockMediaQueueService.advance).toHaveBeenCalledWith(1, { auto: false }, undefined);
    });

    it('returns 400 when step is a float', async () => {
      const res = await request(app)
        .post('/media/queue/advance')
        .send({ step: 1.5, auto: false });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/step/i);
      expect(mockMediaQueueService.advance).not.toHaveBeenCalled();
    });

    it('returns 400 when step is not a number', async () => {
      const res = await request(app)
        .post('/media/queue/advance')
        .send({ step: 'next', auto: false });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/step/i);
      expect(mockMediaQueueService.advance).not.toHaveBeenCalled();
    });

    it('broadcasts the updated queue after advance', async () => {
      await request(app)
        .post('/media/queue/advance')
        .send({ step: 1, auto: true, mutationId: 'adv-5' });

      expect(mockBroadcastEvent).toHaveBeenCalledWith(
        'media:queue',
        expect.objectContaining({ mutationId: 'adv-5' }),
      );
    });
  });

  // ── 10. PUT /media/queue ──────────────────────────────────────────
  describe('PUT /media/queue', () => {
    it('replaces the queue and returns queue JSON', async () => {
      const res = await request(app)
        .put('/media/queue')
        .send({
          items: [{ contentId: 'plex:999', title: 'Replaced' }],
          position: 0,
          shuffle: false,
          repeat: 'off',
          volume: 1.0,
        });

      expect(res.status).toBe(200);
      // The router creates a MediaQueue from the body and calls replace
      expect(mockMediaQueueService.replace).toHaveBeenCalled();
    });
  });

  // ── 10. Broadcast on mutations ───────────────────────────────────
  describe('broadcast on mutations', () => {
    it('broadcasts on POST /queue/items', async () => {
      await request(app)
        .post('/media/queue/items')
        .send({ items: [{ contentId: 'plex:1' }], mutationId: 'b-1' });

      expect(mockBroadcastEvent).toHaveBeenCalledWith(
        'media:queue',
        expect.objectContaining({ mutationId: 'b-1' }),
      );
    });

    it('broadcasts on DELETE /queue/items/:queueId', async () => {
      await request(app)
        .delete('/media/queue/items/abc1')
        .send({ mutationId: 'b-2' });

      expect(mockBroadcastEvent).toHaveBeenCalledWith(
        'media:queue',
        expect.objectContaining({ mutationId: 'b-2' }),
      );
    });

    it('broadcasts on PATCH /queue/items/reorder', async () => {
      await request(app)
        .patch('/media/queue/items/reorder')
        .send({ queueId: 'abc1', toIndex: 1, mutationId: 'b-3' });

      expect(mockBroadcastEvent).toHaveBeenCalledWith(
        'media:queue',
        expect.objectContaining({ mutationId: 'b-3' }),
      );
    });

    it('broadcasts on PATCH /queue/position', async () => {
      await request(app)
        .patch('/media/queue/position')
        .send({ position: 2, mutationId: 'b-4' });

      expect(mockBroadcastEvent).toHaveBeenCalledWith(
        'media:queue',
        expect.objectContaining({ mutationId: 'b-4' }),
      );
    });

    it('broadcasts on PATCH /queue/state', async () => {
      await request(app)
        .patch('/media/queue/state')
        .send({ shuffle: true, mutationId: 'b-5' });

      expect(mockBroadcastEvent).toHaveBeenCalledWith(
        'media:queue',
        expect.objectContaining({ mutationId: 'b-5' }),
      );
    });

    it('broadcasts on DELETE /queue', async () => {
      await request(app)
        .delete('/media/queue')
        .send({ mutationId: 'b-6' });

      expect(mockBroadcastEvent).toHaveBeenCalledWith(
        'media:queue',
        expect.objectContaining({ mutationId: 'b-6' }),
      );
    });

    it('broadcasts on PUT /queue', async () => {
      await request(app)
        .put('/media/queue')
        .send({
          items: [{ contentId: 'plex:1' }],
          position: 0,
          mutationId: 'b-7',
        });

      expect(mockBroadcastEvent).toHaveBeenCalledWith(
        'media:queue',
        expect.objectContaining({ mutationId: 'b-7' }),
      );
    });
  });
});
