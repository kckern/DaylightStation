import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.mjs';

const appFor = service => {
  const app = express();
  app.use(express.json());
  app.use(createHealthRouter({ healthOperations: { defaultUsername: () => 'owner' },
    cleanupProvider: () => service, logger: { info() {}, warn() {}, error() {} } }));
  return app;
};
const serviceStub = () => ({
  journal: vi.fn(async () => ({ rows: [{ runId: 'audit_1' }], total: 1 })),
  journalEntry: vi.fn(async (_user, runId) => (runId === 'audit_1' ? { runId, transcript: null, transcriptExpired: true } : null)),
  spend: vi.fn(async () => ({ days: [{ date: '2026-09-04', costUsd: 0.01, runs: 1, changed: 1 }], today: 0.01, week: 0.01, month: 0.01,
    byTrigger: [], byModel: [], capUsd: 1, cappedToday: false, ledgerTodayUsd: 0.02 })),
  settingsLog: vi.fn(() => [{ field: 'model', from: 'gpt-4.1-mini', to: 'gpt-4o' }]),
});

describe('auditor journal and spend HTTP contract', () => {
  it('lists the journal for the server-owned user with parsed filters', async () => {
    const service = serviceStub();
    const result = await request(appFor(service)).get('/nutrition/cleanup/journal?from=2026-09-01&to=2026-09-04&trigger=captures&changed=1&offset=50&userId=impostor');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ rows: [{ runId: 'audit_1' }], total: 1 });
    expect(service.journal).toHaveBeenCalledWith('owner', { from: '2026-09-01', to: '2026-09-04', trigger: 'captures', changed: true, offset: 50, limit: 50 });
    await request(appFor(service)).get('/nutrition/cleanup/journal');
    expect(service.journal).toHaveBeenLastCalledWith('owner', { from: undefined, to: undefined, trigger: undefined, changed: false, offset: 0, limit: 50 });
  });
  it('rejects bad journal filters', async () => {
    const service = serviceStub();
    for (const query of ['trigger[]=captures', 'trigger=captures&trigger=edits', 'offset[]=1', 'offset=1&offset=2', 'from[]=2026-09-01', 'changed[]=1', 'from=2026-02-31', 'to=yesterday', 'from=2026-09-05&to=2026-09-01', 'offset=-1', 'offset=1.5', 'trigger=cap%20tures', 'trigger=' + 'x'.repeat(40), 'changed=yes']) {
      expect((await request(appFor(service)).get('/nutrition/cleanup/journal?' + query)).status, query).toBe(400);
    }
    expect(service.journal).not.toHaveBeenCalled();
  });
  it('returns one run with its transcript view, 404 for an unknown run, 400 for a bad id', async () => {
    const service = serviceStub();
    const found = await request(appFor(service)).get('/nutrition/cleanup/journal/audit_1?userId=impostor');
    expect(found.status).toBe(200);
    expect(found.body).toEqual({ runId: 'audit_1', transcript: null, transcriptExpired: true });
    expect(service.journalEntry).toHaveBeenCalledWith('owner', 'audit_1', { at: undefined });
    await request(appFor(service)).get('/nutrition/cleanup/journal/audit_1?at=2026-09-04T18:00:00.000Z');
    expect(service.journalEntry).toHaveBeenLastCalledWith('owner', 'audit_1', { at: '2026-09-04T18:00:00.000Z' });
    expect((await request(appFor(service)).get('/nutrition/cleanup/journal/audit_1?at=soon')).status).toBe(400);
    expect((await request(appFor(service)).get('/nutrition/cleanup/journal/audit_1?at[]=x')).status).toBe(400);
    expect((await request(appFor(service)).get('/nutrition/cleanup/journal/audit_missing')).status).toBe(404);
    expect((await request(appFor(service)).get('/nutrition/cleanup/journal/' + 'a'.repeat(65))).status).toBe(400);
    expect((await request(appFor(service)).get('/nutrition/cleanup/journal/bad.id')).status).toBe(400);
  });
  it('reports spend over 1..90 days', async () => {
    const service = serviceStub();
    const result = await request(appFor(service)).get('/nutrition/cleanup/spend?days=14&userId=impostor');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ days: [{ date: '2026-09-04', costUsd: 0.01, runs: 1, changed: 1 }], today: 0.01, week: 0.01, month: 0.01,
      byTrigger: [], byModel: [], capUsd: 1, cappedToday: false, ledgerTodayUsd: 0.02 });
    expect(service.spend).toHaveBeenCalledWith('owner', { days: 14 });
    await request(appFor(service)).get('/nutrition/cleanup/spend');
    expect(service.spend).toHaveBeenLastCalledWith('owner', { days: 30 });
    expect((await request(appFor(service)).get('/nutrition/cleanup/spend?days[]=3')).status).toBe(400);
    expect((await request(appFor(service)).get('/nutrition/cleanup/spend?days=3&days=4')).status).toBe(400);
    for (const days of ['0', '91', '7.5', 'many']) expect((await request(appFor(service)).get('/nutrition/cleanup/spend?days=' + days)).status, days).toBe(400);
  });
  it('returns the settings change log for the owner', async () => {
    const service = serviceStub();
    const result = await request(appFor(service)).get('/nutrition/cleanup/settings/log?userId=impostor');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ entries: [{ field: 'model', from: 'gpt-4.1-mini', to: 'gpt-4o' }] });
    expect(service.settingsLog).toHaveBeenCalledWith('owner');
  });
  it('answers 503 when cleanup is not composed', async () => {
    for (const route of ['/nutrition/cleanup/journal', '/nutrition/cleanup/journal/audit_1', '/nutrition/cleanup/spend', '/nutrition/cleanup/settings/log']) {
      expect((await request(appFor(null)).get(route)).status, route).toBe(503);
    }
  });
});
