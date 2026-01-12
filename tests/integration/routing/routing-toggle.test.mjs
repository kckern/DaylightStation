import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createRoutingMiddleware, ShimMetrics } from '../../../backend/src/0_infrastructure/routing/index.mjs';

describe('Routing Toggle Integration', () => {
  let app;
  let metrics;

  beforeAll(() => {
    app = express();
    metrics = new ShimMetrics();

    const legacyRouter = express.Router();
    legacyRouter.get('/api/finance/data', (req, res) => {
      res.json({ source: 'legacy', budgets: { '2025-01-01': { amount: 1000 } } });
    });

    const newRouter = express.Router();
    newRouter.get('/api/finance/data', (req, res) => {
      res.json({ source: 'new', budgets: [{ periodStart: '2025-01-01', amount: 1000 }] });
    });
    newRouter.get('/api/v2/finance/data', (req, res) => {
      res.json({ source: 'new-v2', budgets: [{ periodStart: '2025-01-01', amount: 1000 }] });
    });

    const config = {
      default: 'legacy',
      routing: {
        '/api/finance': { target: 'new', shim: 'finance-data-v1' },
        '/api/v2/finance': 'new',
      },
    };

    const shims = {
      'finance-data-v1': {
        name: 'finance-data-v1',
        transform: (data) => ({
          source: data.source + '-shimmed',
          budgets: Object.fromEntries(
            data.budgets.map(b => [b.periodStart, { amount: b.amount }])
          ),
        }),
      },
    };

    app.use(createRoutingMiddleware({
      config,
      legacyApp: legacyRouter,
      newApp: newRouter,
      shims,
      logger: { info: () => {}, error: () => {} },
      metrics,
    }));
  });

  it('routes /api/finance to new with shim applied', async () => {
    const res = await request(app).get('/api/finance/data');

    expect(res.status).toBe(200);
    expect(res.headers['x-served-by']).toBe('new');
    expect(res.headers['x-shim-applied']).toBe('finance-data-v1');
    expect(res.body.source).toBe('new-shimmed');
    expect(res.body.budgets['2025-01-01']).toBeDefined();
  });

  it('routes /api/v2/finance to new without shim', async () => {
    const res = await request(app).get('/api/v2/finance/data');

    expect(res.status).toBe(200);
    expect(res.headers['x-served-by']).toBe('new');
    expect(res.headers['x-shim-applied']).toBeUndefined();
    expect(res.body.source).toBe('new-v2');
    expect(Array.isArray(res.body.budgets)).toBe(true);
  });

  it('routes unknown paths to legacy by default', async () => {
    const res = await request(app).get('/api/health/status');

    expect(res.headers['x-served-by']).toBe('legacy');
  });

  it('tracks shim usage in metrics', async () => {
    metrics.reset();
    await request(app).get('/api/finance/data');
    await request(app).get('/api/finance/data');

    const report = metrics.getReport();
    const financeShim = report.find(r => r.shim === 'finance-data-v1');

    expect(financeShim.totalRequests).toBe(2);
  });
});
