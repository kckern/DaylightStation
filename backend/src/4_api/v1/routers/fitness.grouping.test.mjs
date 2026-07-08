import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from './fitness.mjs';
import { SessionGroupingService } from '#apps/fitness/services/SessionGroupingService.mjs';

const H = (h, m) => Date.parse(`2026-06-05T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00-07:00`);
const sess = (id, start, durMin, riders, media = null, coins = 0) => ({
  sessionId: id, date: '2026-06-05', startTime: start, durationMs: durMin * 60000,
  participants: Object.fromEntries(riders.map(r => [r, { displayName: r }])), media, totalCoins: coins,
});
const FIX = [
  sess('s1', H(14,54), 5.5, ['user_3'], null, 60),
  sess('s3', H(16,22), 37.5, ['user_4','user_3'], null, 1139),
  sess('s7', H(19,10), 46.4, ['user_1','user_3'], { primary: { contentId: 'plex:1', title: 'Vid' } }, 2745),
];
const silentLogger = { error() {}, warn() {}, info() {}, debug() {} };

function buildApp() {
  const sessionService = {
    resolveHouseholdId: () => 'household',
    listSessionsInRange: async () => FIX.map(s => ({ ...s })),
    listSessionsByDate: async () => FIX.map(s => ({ ...s })),
  };
  const registry = { enrich: async () => [{ type: 'cycle-game', count: 7, items: [] }] };
  const sessionGroupingService = new SessionGroupingService({ activityRegistry: registry });
  const router = createFitnessRouter({ sessionService, sessionGroupingService, logger: silentLogger });
  const app = express();
  app.use('/api/fitness', router);
  return app;
}

describe('GET /sessions grouping integration', () => {
  it('groups no-video sessions and enriches them by default (since mode, desc order)', async () => {
    const res = await request(buildApp()).get('/api/fitness/sessions?since=2d&limit=50');
    expect(res.status).toBe(200);
    expect(res.body.sessions.map(s => s.id)).toEqual(['s7', 'group:s1']);
    const grp = res.body.sessions.find(s => s.id === 'group:s1');
    expect(grp.activities).toEqual([{ type: 'cycle-game', count: 7, items: [] }]);
    expect(grp.media).toBeNull();
  });

  it('?group=none returns raw ungrouped sessions', async () => {
    const res = await request(buildApp()).get('/api/fitness/sessions?since=2d&limit=50&group=none');
    expect(res.status).toBe(200);
    expect(res.body.sessions.map(s => s.sessionId).sort()).toEqual(['s1', 's3', 's7']);
  });
});
