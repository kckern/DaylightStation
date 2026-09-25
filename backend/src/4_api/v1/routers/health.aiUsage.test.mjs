import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.mjs';

const appFor = (aiUsageService) => {
  const app = express();
  app.use(express.json());
  app.use(createHealthRouter({ healthOperations: { defaultUsername: () => 'owner' }, aiUsageService,
    logger: { info() {}, warn() {}, error() {} } }));
  return app;
};
const usage = { today: 0.01, week: 0.05, month: 0.2, byFeature: [], days: [], beforeTracking: null, range: { days: 30 } };

describe('GET /ai-usage', () => {
  it('returns Health AI usage for the server-owned user, 30 days by default', async () => {
    const service = { usage: vi.fn(async () => usage) };
    const res = await request(appFor(service)).get('/ai-usage?userId=impostor');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(usage);
    expect(service.usage).toHaveBeenCalledWith('owner', { days: 30 });
    await request(appFor(service)).get('/ai-usage?days=90');
    expect(service.usage).toHaveBeenLastCalledWith('owner', { days: 90 });
  });

  it('rejects a bad days value without reading', async () => {
    const service = { usage: vi.fn(async () => usage) };
    for (const q of ['days=0', 'days=91', 'days=7.5', 'days=many', 'days[]=3', 'days=3&days=4']) {
      expect((await request(appFor(service)).get('/ai-usage?' + q)).status, q).toBe(400);
    }
    expect(service.usage).not.toHaveBeenCalled();
  });

  it('answers 503 when no usage service is composed', async () => {
    expect((await request(appFor(null)).get('/ai-usage')).status).toBe(503);
  });
});
