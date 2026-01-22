// tests/unit/api/routers/admin/shims.test.mjs
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createShimsRouter } from '#backend/src/4_api/routers/admin/shims.mjs';

describe('Admin Shims Router', () => {
  let app;
  let mockMetrics;

  beforeEach(() => {
    mockMetrics = {
      getReport: jest.fn().mockReturnValue([
        { endpoint: '/api/local-content/hymns', hits: 5, lastAccess: '2026-01-12T10:00:00Z' },
        { endpoint: '/api/list/plex', hits: 3, lastAccess: '2026-01-12T09:30:00Z' }
      ]),
      reset: jest.fn()
    };

    app = express();
    app.use('/admin/shims', createShimsRouter({ metrics: mockMetrics }));
  });

  describe('GET /admin/shims/report', () => {
    it('returns shim usage report', async () => {
      const res = await request(app).get('/admin/shims/report');

      expect(res.status).toBe(200);
      expect(res.body.shims).toHaveLength(2);
      expect(res.body.shims[0].endpoint).toBe('/api/local-content/hymns');
      expect(res.body.shims[0].hits).toBe(5);
      expect(mockMetrics.getReport).toHaveBeenCalled();
    });

    it('returns empty array when no shims recorded', async () => {
      mockMetrics.getReport.mockReturnValue([]);

      const res = await request(app).get('/admin/shims/report');

      expect(res.status).toBe(200);
      expect(res.body.shims).toEqual([]);
    });
  });

  describe('POST /admin/shims/reset', () => {
    it('resets metrics and returns success', async () => {
      const res = await request(app).post('/admin/shims/reset');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('reset');
      expect(res.body.timestamp).toBeDefined();
      expect(mockMetrics.reset).toHaveBeenCalled();
    });
  });
});
