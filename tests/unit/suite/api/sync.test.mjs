// tests/unit/suite/api/sync.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createSyncRouter } from '#api/v1/routers/sync.mjs';

describe('Sync API', () => {
  let app;
  let mockSyncService;

  beforeEach(() => {
    mockSyncService = {
      sync: jest.fn().mockResolvedValue({ synced: 30, errors: 0 }),
      getStatus: jest.fn().mockResolvedValue({ lastSynced: '2026-02-23T10:00:00Z', itemCount: 30 })
    };

    app = express();
    app.use(express.json());
    app.use('/api/v1/sync', createSyncRouter({
      syncService: mockSyncService,
      logger: { info: jest.fn(), error: jest.fn() }
    }));
  });

  describe('POST /api/v1/sync/:source', () => {
    it('triggers sync and returns result', async () => {
      const res = await request(app).post('/api/v1/sync/retroarch');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ synced: 30, errors: 0 });
      expect(mockSyncService.sync).toHaveBeenCalledWith('retroarch');
    });
  });

  describe('GET /api/v1/sync/:source/status', () => {
    it('returns sync status', async () => {
      const res = await request(app).get('/api/v1/sync/retroarch/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ lastSynced: '2026-02-23T10:00:00Z', itemCount: 30 });
    });
  });
});
