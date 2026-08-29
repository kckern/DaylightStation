// tests/isolated/api/routers/canvas.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Readable } from 'node:stream';
import { createCanvasRouter } from '../../../../backend/src/4_api/v1/routers/canvas.mjs';

describe('Canvas API', () => {
  let app;
  let mockCanvasService;
  let getCanvasImage;

  beforeEach(() => {
    mockCanvasService = {
      getCurrent: vi.fn().mockResolvedValue({
        id: 'canvas:test',
        title: 'Test Art',
        imageUrl: '/api/v1/canvas/image/test',
        category: 'landscapes',
        frameStyle: 'classic',
      }),
      startRotation: vi.fn().mockResolvedValue(undefined),
      stopRotation: vi.fn(),
    };

    getCanvasImage = { execute: vi.fn().mockResolvedValue({
      size: 5, mimeType: 'image/jpeg', open: () => Readable.from(Buffer.from('image')),
    }) };
    const sendFileResource = vi.fn((_req, res, image) => {
      res.type(image.mimeType);
      return image.open().pipe(res);
    });
    const router = createCanvasRouter({ canvasService: mockCanvasService, getCanvasImage, sendFileResource });
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.householdId = 'test-household';
      next();
    });
    app.use('/api/v1/canvas', router);
  });

  describe('GET /image/*', () => {
    it('sends the opaque image resource returned by the use case', async () => {
      const res = await request(app).get('/api/v1/canvas/image/gallery/work.jpg');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^image\/jpeg/);
      expect(getCanvasImage.execute).toHaveBeenCalledWith('gallery/work.jpg');
    });

    it('preserves the image-not-found envelope', async () => {
      getCanvasImage.execute.mockResolvedValueOnce(null);
      const res = await request(app).get('/api/v1/canvas/image/missing.jpg');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Image not found', path: 'missing.jpg' });
    });
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
