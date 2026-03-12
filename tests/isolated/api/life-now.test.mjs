import { describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import createNowRouter from '#api/v1/routers/life/now.mjs';

describe('Life Now API Router', () => {
  let app;
  let mockAlignmentService;
  let mockDriftService;

  const alignmentResult = {
    priorities: [
      { type: 'goal_deadline', title: 'Run marathon in 10 days', score: 100 },
      { type: 'drift_alert', title: 'Value drift detected', score: 40 },
    ],
    dashboard: {
      valueDrift: { correlation: 0.65, status: 'drifting' },
      goalProgress: [{ id: 'g1', name: 'Run marathon', progress: 0.5 }],
      beliefConfidence: [{ id: 'b1', confidence: 0.6 }],
      cadencePosition: { unit: { periodId: '2025-U165' } },
    },
    briefingContext: {
      plan: { purpose: { statement: 'Maximize joy' } },
      snapshot: { correlation: 0.65 },
    },
    _meta: { computedAt: '2025-06-15T10:00:00Z', username: 'testuser' },
  };

  beforeEach(() => {
    mockAlignmentService = {
      computeAlignment: jest.fn().mockReturnValue(alignmentResult),
    };

    mockDriftService = {
      getLatestSnapshot: jest.fn().mockReturnValue({ correlation: 0.65, status: 'drifting' }),
      getHistory: jest.fn().mockReturnValue([
        { date: '2025-06-01', correlation: 0.9 },
        { date: '2025-06-08', correlation: 0.65 },
      ]),
      computeAndSave: jest.fn().mockResolvedValue({ correlation: 0.72, status: 'drifting' }),
    };

    const router = createNowRouter({
      alignmentService: mockAlignmentService,
      driftService: mockDriftService,
    });

    app = express();
    app.use(express.json());
    app.use('/now', router);
  });

  describe('GET /now', () => {
    it('returns priorities by default', async () => {
      const res = await request(app).get('/now');
      expect(res.status).toBe(200);
      expect(res.body.priorities).toHaveLength(2);
      expect(res.body.dashboard).toBeUndefined();
    });

    it('returns dashboard when mode=dashboard', async () => {
      const res = await request(app).get('/now?mode=dashboard');
      expect(res.status).toBe(200);
      expect(res.body.dashboard).toBeDefined();
      expect(res.body.dashboard.valueDrift.correlation).toBe(0.65);
    });

    it('returns briefing context when mode=briefing', async () => {
      const res = await request(app).get('/now?mode=briefing');
      expect(res.status).toBe(200);
      expect(res.body.briefingContext).toBeDefined();
    });
  });

  describe('GET /now/drift', () => {
    it('returns latest drift snapshot', async () => {
      const res = await request(app).get('/now/drift');
      expect(res.status).toBe(200);
      expect(res.body.correlation).toBe(0.65);
      expect(res.body.status).toBe('drifting');
    });
  });

  describe('GET /now/drift/history', () => {
    it('returns drift history', async () => {
      const res = await request(app).get('/now/drift/history');
      expect(res.status).toBe(200);
      expect(res.body.history).toHaveLength(2);
    });
  });

  describe('POST /now/drift/refresh', () => {
    it('recomputes and returns new snapshot', async () => {
      const res = await request(app).post('/now/drift/refresh');
      expect(res.status).toBe(200);
      expect(res.body.correlation).toBe(0.72);
      expect(mockDriftService.computeAndSave).toHaveBeenCalled();
    });
  });
});
