import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDoNowRouter } from '../../../../backend/src/4_api/v1/routers/donow.mjs';

const silentLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function buildApp({ expectedToken = null, service, approvals } = {}) {
  const app = express();
  app.use('/api/v1/donow', createDoNowRouter({
    service, approvals, expectedToken, logger: silentLogger,
  }));
  return app;
}

describe('createDoNowRouter', () => {
  let service;
  let approvals;

  beforeEach(() => {
    service = {
      dispatch: vi.fn(),
      listSurfaces: vi.fn(() => [
        { id: 'garage-fitness', label: 'Garage Fitness' },
        { id: 'thermal' },
      ]),
    };
    approvals = {
      listPending: vi.fn(),
      approve: vi.fn(),
      deny: vi.fn(),
    };
  });

  describe('POST /dispatch', () => {
    it('happy path: calls service.dispatch with requestedBy:"api" and returns its result', async () => {
      service.dispatch.mockResolvedValue({ decision: 'dispatched', message: 'Starting now.' });
      const app = buildApp({ service, approvals });

      const res = await request(app)
        .post('/api/v1/donow/dispatch')
        .send({ surface: 'garage-fitness', action: { episode: 'plex:1' }, learnerId: 'kid1', ref: 'ses_1' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ decision: 'dispatched', message: 'Starting now.' });
      expect(service.dispatch).toHaveBeenCalledWith({
        surface: 'garage-fitness',
        action: { episode: 'plex:1' },
        learnerId: 'kid1',
        ref: 'ses_1',
        force: undefined,
        programId: undefined,
        requestedBy: 'api',
      });
    });
  });

  describe('GET /surfaces', () => {
    it('returns { surfaces } — ids + human labels only', async () => {
      const app = buildApp({ service, approvals });

      const res = await request(app).get('/api/v1/donow/surfaces');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        surfaces: [
          { id: 'garage-fitness', label: 'Garage Fitness' },
          { id: 'thermal' },
        ],
      });
    });
  });

  describe('GET /approvals', () => {
    it('returns { pending }', async () => {
      approvals.listPending.mockResolvedValue([{ id: 'dnr_1' }]);
      const app = buildApp({ service, approvals });

      const res = await request(app).get('/api/v1/donow/approvals');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ pending: [{ id: 'dnr_1' }] });
    });
  });

  describe('POST /approvals/:id/approve|deny — auth posture', () => {
    it('open (no token configured): approve succeeds with no token supplied', async () => {
      approvals.approve.mockResolvedValue({ decision: 'dispatched', message: 'ok' });
      const app = buildApp({ service, approvals, expectedToken: null });

      const res = await request(app).post('/api/v1/donow/approvals/dnr_1/approve');

      expect(res.status).toBe(200);
      expect(approvals.approve).toHaveBeenCalledWith({ id: 'dnr_1' });
    });

    it('token configured + wrong/missing token -> 401, approve is never called', async () => {
      const app = buildApp({ service, approvals, expectedToken: 'secret' });

      const res = await request(app).post('/api/v1/donow/approvals/dnr_1/approve');

      expect(res.status).toBe(401);
      expect(approvals.approve).not.toHaveBeenCalled();
    });

    it('token configured + correct token via ?token= query -> 200', async () => {
      approvals.approve.mockResolvedValue({ decision: 'dispatched', message: 'ok' });
      const app = buildApp({ service, approvals, expectedToken: 'secret' });

      const res = await request(app).post('/api/v1/donow/approvals/dnr_1/approve?token=secret');

      expect(res.status).toBe(200);
      expect(approvals.approve).toHaveBeenCalledWith({ id: 'dnr_1' });
    });

    it('token configured + correct token via body -> 200 for deny', async () => {
      approvals.deny.mockResolvedValue({ decision: 'denied', message: 'ok' });
      const app = buildApp({ service, approvals, expectedToken: 'secret' });

      const res = await request(app)
        .post('/api/v1/donow/approvals/dnr_1/deny')
        .send({ token: 'secret' });

      expect(res.status).toBe(200);
      expect(approvals.deny).toHaveBeenCalledWith({ id: 'dnr_1' });
    });

    it('token configured + wrong token on deny -> 401', async () => {
      const app = buildApp({ service, approvals, expectedToken: 'secret' });

      const res = await request(app)
        .post('/api/v1/donow/approvals/dnr_1/deny')
        .send({ token: 'nope' });

      expect(res.status).toBe(401);
      expect(approvals.deny).not.toHaveBeenCalled();
    });
  });
});
