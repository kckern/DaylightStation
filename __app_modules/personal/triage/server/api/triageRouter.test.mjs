import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createTriageRuntime } from '../composition.mjs';

const make = (configuration = {}) => createTriageRuntime({
  configuration: () => configuration, defaultUsername: 'head', isKnownUser: u => ['head', 'sample'].includes(u),
  dataService: null, mailbox: null, work: null, decisionGateway: null, aiGateway: null, agentsScheduler: null,
  clock: () => 0, logger: null,
});
const app = (rt) => express().use('/api/v1/triage', rt.router);

describe('triage router', () => {
  it('reports the default user as not enrolled', async () => {
    const res = await request(app(make())).get('/api/v1/triage/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ username: 'head', enrolled: false, mode: 'off' });
  });
  it('404s an unknown user', async () => {
    expect((await request(app(make())).get('/api/v1/triage/status?username=ghost')).status).toBe(404);
  });
  it('reports an enrolled user', async () => {
    const cfg = { triage: { enabled: true, defaults: { mode: 'dryRun' }, users: { sample: {} } } };
    const res = await request(app(make(cfg))).get('/api/v1/triage/status?username=sample');
    expect(res.body).toEqual({ username: 'sample', enrolled: true, mode: 'dryRun' });
  });
});
