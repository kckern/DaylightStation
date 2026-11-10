// @vitest-environment node
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { GemBoardService } from './GemBoardService.mjs';
import { EarningsPreviewService } from './EarningsPreviewService.mjs';
import { createEarningsRouter } from '../api/earnings.mjs';
import { validateRuleset } from '../domain/earnings/index.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const TZ = 'America/Los_Angeles';
const RULES = validateRuleset({
  revision: 1,
  rules: [
    { id: 'moved', label: 'Moved', kind: 'ring-days', days: 2, reward: { gems: 1 }, gem: { category: 'exercise', label: 'Exercise' } },
    { id: 'contest', label: 'Most rings', kind: 'ring-contest', reward: { silver: 5, gems: 1 } },
  ],
});
// Wed 2026-11-04 noon Pacific.
const NOW = '2026-11-04T20:00:00.000Z';
const at = (iso) => Date.parse(iso);

function build({ sessions, mode = 'live' } = {}) {
  const preview = new EarningsPreviewService({
    rules: { get: async () => RULES },
    schoolEvidence: { async schoolWeek() { return {}; } },
    ringEvidence: {
      async standings({ learnerIds }) {
        return learnerIds.map((learnerId) => {
          const mine = (sessions[learnerId] ?? []);
          return { learnerId, rings: mine.reduce((s, x) => s + x.rings, 0), sessions: mine };
        });
      },
    },
    learners: async () => [{ id: 'a', name: 'Kid A' }, { id: 'b', name: 'Kid B' }],
    clock: () => new Date(NOW),
    timezone: TZ,
    logger: silent,
  });
  const economy = {
    hasUser: (id) => id === 'a',
    async getHistory() { return [{ kind: 'earn', source: 'payout', action: 'payout:moved', ref: 'r1:gems', ruleId: 'moved', delta: 1, currency: 'gems' }]; },
    async peekBalance() { return { silver: 3, gold: 0, gems: 4 }; },
  };
  return new GemBoardService({ preview, rules: { get: async () => RULES }, economy, config: { catalog: () => ({ mode }) }, logger: silent });
}

describe('GemBoardService', () => {
  it('groups FINISHED workouts by study day (4 am boundary), so a late-night ride counts for its own day', async () => {
    const board = await build({
      sessions: {
        // Mon 23:30 Pacific and Tue 03:00 Pacific are both Monday's study day; Tue 18:00 is Tuesday.
        a: [
          { sessionId: '1', startMs: at('2026-11-03T07:30:00Z'), rings: 30, final: true },
          { sessionId: '2', startMs: at('2026-11-03T11:00:00Z'), rings: 30, final: true },
          { sessionId: '3', startMs: at('2026-11-04T02:00:00Z'), rings: 30, final: true },
        ],
        // Two days, but Tuesday's ride is still live: one moved day so far.
        b: [
          { sessionId: '4', startMs: at('2026-11-03T07:30:00Z'), rings: 30, final: true },
          { sessionId: '5', startMs: at('2026-11-04T19:00:00Z'), rings: 30, final: false },
        ],
      },
    }).board();
    expect(board.categories.map((c) => c.id)).toEqual(['exercise', 'ring-contests']);
    expect(board.cells.exercise.a).toMatchObject({ state: 'earned', week: 1 });
    expect(board.cells.exercise.b).toMatchObject({ state: 'pending', progress: { have: 1, need: 2 } });
    expect(board.cells['ring-contests'].a.state).toBe('leading');
    // Lifetime from the ledger only for a household user; the wallet's gems are the total.
    expect(board.cells.exercise.a.lifetime).toBe(1);
    expect(board.totals).toEqual({ a: { week: 2, earned: 1, lifetime: 4 }, b: { week: 0, earned: 0, lifetime: 0 } });
  });

  it('economy off: an empty board', async () => {
    expect(await build({ sessions: {}, mode: 'off' }).board()).toMatchObject({ mode: 'off', learners: [], categories: [] });
  });

  it('GET /earnings/gems serves the board no-store; 503 when unwired', async () => {
    const gemBoard = build({ sessions: {} });
    const earningsPreview = { preview() {}, roster() {} };
    const earnRules = { describe() {} };
    const app = express();
    app.use('/earnings', createEarningsRouter({ earningsPreview, earnRules, gemBoard, logger: silent }));
    const res = await request(app).get('/earnings/gems');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.learners.map((l) => l.learnerId)).toEqual(['a', 'b']);
    const bare = express();
    bare.use('/earnings', createEarningsRouter({ earningsPreview, earnRules, logger: silent }));
    expect((await request(bare).get('/earnings/gems')).status).toBe(503);
  });
});
