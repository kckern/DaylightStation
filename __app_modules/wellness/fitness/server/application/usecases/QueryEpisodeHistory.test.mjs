// Tests for grouping the session index by episode (who did it, when).
import { describe, it, expect } from 'vitest';
import { QueryEpisodeHistory, normalizeEpisodeId, riderMinutes } from './QueryEpisodeHistory.mjs';

const session = (sessionId, startTime, contentId, participants) => ({
  sessionId, date: '2026-10-' + String(sessionId).slice(6, 8), startTime,
  participants,
  media: contentId ? { primary: { contentId } } : null,
});

const rider = (minutes, extra = {}) => ({ displayName: 'Rider', zoneMinutes: { cool: minutes }, rings: 10, ...extra });

function makeUseCase(sessions) {
  const calls = [];
  const sessionService = {
    async listSessionsInRange(start, end, hid) { calls.push({ start, end, hid }); return sessions; },
  };
  const logs = [];
  const logger = { info: (event, data) => logs.push({ event, data }) };
  const uc = new QueryEpisodeHistory({ sessionService, logger, now: () => new Date('2026-10-22T12:00:00Z') });
  return { uc, calls, logs };
}

describe('QueryEpisodeHistory', () => {
  it('groups sessions by their primary episode, newest first, only for the asked episodes', async () => {
    const { uc, calls } = makeUseCase([
      session('20261014070000', 1000, 'plex:1', { 'rider-a': rider(28) }),
      session('20261022070000', 3000, 'plex:1', { 'rider-a': rider(31), 'rider-b': rider(30) }),
      session('20261020070000', 2000, 'plex:2', { 'rider-b': rider(20) }),
      session('20261021070000', 2500, 'plex:9', { 'rider-a': rider(20) }),
      session('20261019070000', 1500, null, { 'rider-a': rider(20) }),
    ]);
    const { episodes } = await uc.execute({ episodeIds: ['1', 'plex:2', 'plex:3'], household: 'hh' });

    expect(Object.keys(episodes).sort()).toEqual(['plex:1', 'plex:2']);
    expect(episodes['plex:1'].map((s) => s.sessionId)).toEqual(['20261022070000', '20261014070000']);
    expect(episodes['plex:1'][0].riders.map((r) => r.id)).toEqual(['rider-a', 'rider-b']);
    expect(episodes['plex:1'][0].riders[0]).toEqual({ id: 'rider-a', displayName: 'Rider', minutes: 31, rings: 10, isGuest: false });
    expect(calls[0]).toEqual({ start: '2010-01-01', end: '2026-10-22', hid: 'hh' });
  });

  it('carries the guest flag and leaves minutes null when no zone time was recorded', async () => {
    const { uc } = makeUseCase([
      session('20261022070000', 3000, 'plex:1', {
        'guest-1': { displayName: 'Guest', zoneMinutes: { cool: 12 }, rings: 3, isGuest: true },
        'rider-a': { displayName: 'Rider', zoneMinutes: null, rings: null },
      }),
    ]);
    const [entry] = (await uc.execute({ episodeIds: ['plex:1'] })).episodes['plex:1'];
    expect(entry.riders.find((r) => r.id === 'guest-1')).toMatchObject({ isGuest: true, minutes: 12 });
    expect(entry.riders.find((r) => r.id === 'rider-a')).toMatchObject({ isGuest: false, minutes: null, rings: null });
  });

  it('skips the index read entirely when no episodes are asked for, and logs each query', async () => {
    const { uc, calls, logs } = makeUseCase([]);
    expect(await uc.execute({ episodeIds: [] })).toEqual({ episodes: {} });
    expect(calls).toHaveLength(0);
    await uc.execute({ episodeIds: ['plex:1'] });
    expect(logs.at(-1)).toMatchObject({ event: 'fitness.episode_history.query', data: { requested: 1, matched: 0, scanned: 0 } });
  });

  it('normalizes ids and sums zone minutes', () => {
    expect(normalizeEpisodeId('605624')).toBe('plex:605624');
    expect(normalizeEpisodeId(605624)).toBe('plex:605624');
    expect(normalizeEpisodeId('plex:605624')).toBe('plex:605624');
    expect(normalizeEpisodeId('  ')).toBeNull();
    expect(riderMinutes({ zoneMinutes: { cool: 21, active: 5.5, warm: 1.08 } })).toBe(27.6);
    expect(riderMinutes({ zoneMinutes: { cool: 0 } })).toBeNull();
    expect(riderMinutes({})).toBeNull();
  });
});
