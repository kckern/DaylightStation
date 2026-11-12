import { describe, expect, it } from 'vitest';
import { SkylineInvadersProvider } from './SkylineInvadersProvider.mjs';

describe('SkylineInvadersProvider', () => {
  const run = { run: { id: 'run-1', level_id: 'invaders-1-1', started_at: '2026-11-11T17:00:00.000Z', ended_at: '2026-11-11T17:03:00.000Z', status: 'completed', duration_s: 180, score: 340, kills: 12, stars: 2, partner_id: 'partner' }, rider: { user_id: 'shooter' } };
  const window = [Date.parse('2026-11-11T16:59:00Z'), Date.parse('2026-11-11T17:06:00Z'), '2026-11-11', 'home'];
  it('projects overlapping rounds into session activities, shooter and partner both', async () => {
    const provider = new SkylineInvadersProvider({ runService: { listByDate: async () => [run] } });
    expect(provider.type).toBe('skyline-invaders');
    const items = await provider.loadOverlapping(...window);
    expect(items).toEqual([{ startMs: Date.parse(run.run.started_at), endMs: Date.parse(run.run.ended_at), participants: ['shooter', 'partner'], meta: { runId: 'run-1', levelId: 'invaders-1-1', status: 'completed', durationS: 180, score: 340, kills: 12, stars: 2 } }]);
  });
  it('lists the shooter alone when there was no partner', async () => {
    const solo = { ...run, run: { ...run.run, partner_id: undefined } };
    const provider = new SkylineInvadersProvider({ runService: { listByDate: async () => [solo] } });
    expect((await provider.loadOverlapping(...window))[0].participants).toEqual(['shooter']);
  });
  it('orders rounds by start time and asks for the given date and household', async () => {
    const later = { ...run, run: { ...run.run, id: 'run-2', started_at: '2026-11-11T17:04:00.000Z', ended_at: '2026-11-11T17:05:00.000Z' } };
    const asked = [];
    const provider = new SkylineInvadersProvider({ runService: { listByDate: async (...args) => { asked.push(args); return [later, run]; } } });
    expect((await provider.loadOverlapping(...window)).map((item) => item.meta.runId)).toEqual(['run-1', 'run-2']);
    expect(asked).toEqual([['2026-11-11', 'home']]);
  });
  it('drops rounds outside the window and tolerates no runs', async () => {
    const provider = new SkylineInvadersProvider({ runService: { listByDate: async () => null } });
    expect(await provider.loadOverlapping(0, 1, '2026-11-11', 'home')).toEqual([]);
    const far = new SkylineInvadersProvider({ runService: { listByDate: async () => [run] } });
    expect(await far.loadOverlapping(0, 1000, '2026-11-11', 'home')).toEqual([]);
  });
  it('requires a run service', () => { expect(() => new SkylineInvadersProvider()).toThrow(/runService/); });
});
