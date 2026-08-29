import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestRouter } from './test.mjs';

describe('test infrastructure router enablement', () => {
  it('preserves the production 403 envelope when composition disables it', async () => {
    const app = express().use('/test', createTestRouter({ enabled: false }));
    const response = await request(app).get('/test/anything');
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Test endpoints disabled in production' });
  });

  it('preserves the 503 envelope when enabled without shutoff controls', async () => {
    const app = express().use('/test', createTestRouter({ enabled: true }));
    const response = await request(app).post('/test/plex/shutoff/enable');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Plex shutoff controls not configured' });
  });
});
