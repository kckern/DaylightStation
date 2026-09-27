import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createEarningsRouter } from './earnings.mjs';
import { EarningsPreviewService } from '#apps/economy/EarningsPreviewService.mjs';
import { EarnRulesService } from '#apps/economy/EarnRulesService.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function app() {
  const store = { doc: null, async read() { return this.doc; }, async write(d) { this.doc = d; }, async history() { return []; } };
  const earnRules = new EarnRulesService({ store, clock: () => new Date('2026-09-26T17:00:00Z'), logger: silent });
  const earningsPreview = new EarningsPreviewService({
    rules: earnRules,
    schoolEvidence: { async schoolWeek({ week }) {
      return { sectionDays: [{ day: '2026-09-21', subject: 'language', state: 'served', reason: null, timeliness: 'on-time' }], days: [], week: { weekId: week.from, state: 'met', open: false }, units: [] };
    } },
    ringEvidence: { async standings({ learnerIds }) { return learnerIds.map((learnerId) => ({ learnerId, rings: 0 })); } },
    learners: async () => [{ id: 'learner-a', name: 'Learner A' }, { id: 'learner-b', name: 'Learner B' }],
    clock: () => new Date('2026-09-26T17:00:00Z'),
    timezone: 'America/Los_Angeles',
    logger: silent,
  });
  const a = express();
  a.use('/earnings', createEarningsRouter({ earningsPreview, earnRules, logger: silent }));
  return a;
}

describe('/earnings', () => {
  it('GET /preview prices every learner for the week, no-store', async () => {
    const res = await request(app()).get('/earnings/preview?week=2026-09-24');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.windows.school).toEqual({ from: '2026-09-21', to: '2026-09-27' });
    expect(res.body.learners.map((l) => l.learnerId)).toEqual(['learner-a', 'learner-b']);
    expect(res.body.learners[0].totals.silver).toBeGreaterThan(0);
  });

  it('GET /preview/:learnerId prices one learner', async () => {
    const res = await request(app()).get('/earnings/preview/learner-a');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ learnerId: 'learner-a', learnerName: 'Learner A', currency: 'silver' });
    expect(Array.isArray(res.body.lines)).toBe(true);
  });

  it('an unknown learner is 404, a malformed week 400', async () => {
    expect((await request(app()).get('/earnings/preview/nobody')).status).toBe(404);
    expect((await request(app()).get('/earnings/preview?week=bad')).status).toBe(400);
  });

  it('GET /rules returns the rules in force with their revision', async () => {
    const res = await request(app()).get('/earnings/rules');
    expect(res.status).toBe(200);
    expect(res.body.ruleset).toMatchObject({ revision: 0, currency: 'silver' });
    expect(res.body.ruleset.rules.length).toBeGreaterThan(0);
    expect(res.body.kinds).toContain('section-week');
  });

  it('is read-only: no write route exists here (each surface gates its own)', async () => {
    expect((await request(app()).put('/earnings/rules').send({})).status).toBe(404);
  });
});
