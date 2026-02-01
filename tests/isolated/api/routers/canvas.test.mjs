// tests/isolated/api/routers/canvas.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createCanvasRouter } from '../../../../backend/src/4_api/v1/routers/canvas.mjs';

describe('Canvas API', () => {
  let app;
  let mockCanvasService;

  beforeEach(() => {
    mockCanvasService = {
      getCurrent: jest.fn().mockResolvedValue({
        id: 'canvas:test',
        title: 'Test Art',
        imageUrl: '/api/v1/canvas/image/test',
        category: 'landscapes',
        frameStyle: 'classic',
      }),
      startRotation: jest.fn().mockResolvedValue(undefined),
      stopRotation: jest.fn(),
    };

    const router = createCanvasRouter({ canvasService: mockCanvasService });
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.householdId = 'test-household';
      next();
    });
    app.use('/api/v1/canvas', router);
  });

  describe('GET /current', () => {
    it('returns current art for device', async () => {
      const res = await request(app)
        .get('/api/v1/canvas/current')
        .query({ deviceId: 'living-room-tv' });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('canvas:test');
      expect(mockCanvasService.getCurrent).toHaveBeenCalledWith('living-room-tv', 'test-household');
    });

    it('requires deviceId', async () => {
      const res = await request(app).get('/api/v1/canvas/current');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/deviceId/);
    });
  });

  describe('POST /next', () => {
    it('advances to next art', async () => {
      const res = await request(app)
        .post('/api/v1/canvas/next')
        .send({ deviceId: 'living-room-tv' });

      expect(res.status).toBe(200);
      expect(mockCanvasService.getCurrent).toHaveBeenCalled();
    });
  });

  describe('POST /rotation/start', () => {
    it('starts rotation for device', async () => {
      const res = await request(app)
        .post('/api/v1/canvas/rotation/start')
        .send({ deviceId: 'living-room-tv' });

      expect(res.status).toBe(200);
      expect(mockCanvasService.startRotation).toHaveBeenCalledWith('living-room-tv', 'test-household');
    });
  });

  describe('POST /rotation/stop', () => {
    it('stops rotation for device', async () => {
      const res = await request(app)
        .post('/api/v1/canvas/rotation/stop')
        .send({ deviceId: 'living-room-tv' });

      expect(res.status).toBe(200);
      expect(mockCanvasService.stopRotation).toHaveBeenCalledWith('living-room-tv');
    });
  });
});
