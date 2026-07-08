import { describe, it, expect } from 'vitest';
import { SessionGroupingService } from './SessionGroupingService.mjs';

const T0 = Date.parse('2026-06-05T16:22:00-07:00');
const tl = (ticks, val) => ({ series: { 'user_3:heart_rate': Array(ticks).fill(val) }, events: [], tick_count: ticks, interval_seconds: 5 });

// two no-video sessions that groupSessions will merge (overlap on user_3); 10-min idle gap
const s1 = { sessionId: '20260605162200', date: '2026-06-05', startTime: T0, durationMs: 15000, participants: { user_3: { displayName: 'user_3' }, user_4: { displayName: 'user_4' } }, media: null, totalCoins: 100 };
const s2 = { sessionId: '20260605163000', date: '2026-06-05', startTime: T0 + 600000, durationMs: 10000, participants: { user_3: { displayName: 'user_3' } }, media: null, totalCoins: 50 };

const sessionService = {
  resolveHouseholdId: () => 'household',
  listSessionsByDate: async () => [ { ...s1 }, { ...s2 } ],
  getSession: async (id) => ({ timeline: id === s1.sessionId ? tl(3, 'a') : tl(2, 'b') }),
};

// one race inside s2, 2s after it starts, lasting 3s
const registry = { enrich: async () => [{ type: 'cycle-game', count: 1,
  items: [{ startMs: s2.startTime + 2000, endMs: s2.startTime + 5000, participants: ['user_3'], meta: { winnerId: 'user_3' } }] }] };

describe('SessionGroupingService.getGroupDetail', () => {
  it('stitches member timelines, compresses the gap, and emits a seam', async () => {
    const svc = new SessionGroupingService({ activityRegistry: registry, sessionService });
    const detail = await svc.getGroupDetail('group:20260605162200', 'household');
    expect(detail.isGroup).toBe(true);
    expect(detail.date).toBe('2026-06-05');
    expect(detail.timeline.tick_count).toBe(5);                 // 3 + 0 + 2 (no null filler)
    expect(detail.timeline.series['user_3:heart_rate']).toEqual(['a','a','a','b','b']);
    expect(detail.segments.map(s => s.offsetMs)).toEqual([0, 15000]); // 3 ticks * 5s
    expect(detail.seams).toEqual([{ atMs: 15000, gapMs: 585000 }]);   // gap = 600000 - 15000
    expect(detail.media).toBeNull();
    expect(Object.keys(detail.participants).sort()).toEqual(['user_3','user_4']);
  });

  it('rebases activity bands onto the compressed axis', async () => {
    const svc = new SessionGroupingService({ activityRegistry: registry, sessionService });
    const detail = await svc.getGroupDetail('group:20260605162200', 'household');
    const band = detail.activities[0].items[0];
    expect(band.axisStartMs).toBe(15000 + 2000); // s2 offset + 2s into s2
    expect(band.axisEndMs).toBe(15000 + 5000);
  });

  it('truncates an earlier band so no race nests inside another', async () => {
    // two races in s2 whose rebased bands would overlap (A spans into B) — A must be cut to B's start
    const overlapReg = { enrich: async () => [{ type: 'cycle-game', count: 2, items: [
      { startMs: s2.startTime + 0,    endMs: s2.startTime + 8000, participants: ['user_3'], meta: { raceId: 'A' } },
      { startMs: s2.startTime + 2000, endMs: s2.startTime + 5000, participants: ['user_3'], meta: { raceId: 'B' } },
    ] }] };
    const svc = new SessionGroupingService({ activityRegistry: overlapReg, sessionService });
    const detail = await svc.getGroupDetail('group:20260605162200', 'household');
    const items = detail.activities[0].items.slice().sort((x, y) => x.axisStartMs - y.axisStartMs);
    expect(items[0].axisEndMs).toBeLessThanOrEqual(items[1].axisStartMs); // A truncated, no nesting
  });

  it('returns null for an unknown group id', async () => {
    const svc = new SessionGroupingService({ activityRegistry: registry, sessionService });
    expect(await svc.getGroupDetail('group:20991231000000', 'household')).toBeNull();
  });

  it('keeps cumulative series continuous across seams (offsets later segments by the running total)', async () => {
    // user_3:coins is cumulative and restarts each session; heart_rate is instantaneous
    const svcSessions = {
      resolveHouseholdId: () => 'household',
      listSessionsByDate: async () => [ { ...s1 }, { ...s2 } ],
      getSession: async (id) => ({
        timeline: id === s1.sessionId
          ? { series: { 'user_3:coins': [10, 20, 30], 'user_3:heart_rate': [100, 100, 100] }, events: [], tick_count: 3, interval_seconds: 5 }
          : { series: { 'user_3:coins': [5, 15], 'user_3:heart_rate': [120, 120] }, events: [], tick_count: 2, interval_seconds: 5 },
      }),
    };
    const svc = new SessionGroupingService({ activityRegistry: registry, sessionService: svcSessions });
    const detail = await svc.getGroupDetail('group:20260605162200', 'household');
    // cumulative: second segment offset by 30 (running total at the seam) -> 5+30, 15+30
    expect(detail.timeline.series['user_3:coins']).toEqual([10, 20, 30, 35, 45]);
    // instantaneous untouched
    expect(detail.timeline.series['user_3:heart_rate']).toEqual([100, 100, 100, 120, 120]);
  });
});

describe('SessionGroupingService.enrichSession (standalone session detail)', () => {
  // A lone session that groupSessions keeps standalone (group id === sessionId).
  const SOLO = '20260612081413';
  const SOLO_START = Date.parse('2026-06-12T08:14:13-07:00');
  const solo = {
    sessionId: SOLO, date: '2026-06-12', startTime: SOLO_START, durationMs: 690000,
    participants: { user_2: { displayName: 'User_2' } }, media: null, totalCoins: 216,
  };
  const raceReg = { enrich: async () => [{ type: 'cycle-game', count: 2, items: [
    { startMs: SOLO_START + 70000, endMs: SOLO_START + 130000, participants: ['user_2'], meta: { raceId: 'a', winnerId: 'user_2' } },
    { startMs: SOLO_START + 200000, endMs: SOLO_START + 380000, participants: ['user_2'], meta: { raceId: 'b', winnerId: 'user_2' } },
  ] }] };
  const sessions = { resolveHouseholdId: () => 'household', listSessionsByDate: async () => [ { ...solo } ] };

  it('returns overlapping race activities for a standalone session (raw absolute startMs)', async () => {
    const svc = new SessionGroupingService({ activityRegistry: raceReg, sessionService: sessions });
    const activities = await svc.enrichSession(SOLO, 'household');
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ type: 'cycle-game', count: 2 });
    // items keep absolute startMs (no axis rebase — the single-session timeline does that client-side)
    expect(activities[0].items[0].startMs).toBe(SOLO_START + 70000);
    expect(activities[0].items[0].axisStartMs).toBeUndefined();
  });

  it('returns [] when the session has media (video sessions are not activity-enriched)', async () => {
    const withMedia = { resolveHouseholdId: () => 'household', listSessionsByDate: async () => [ { ...solo, media: { primary: { contentId: 'plex:1' } } } ] };
    const svc = new SessionGroupingService({ activityRegistry: raceReg, sessionService: withMedia });
    expect(await svc.enrichSession(SOLO, 'household')).toEqual([]);
  });

  it('returns [] when the session id is not present that day', async () => {
    const svc = new SessionGroupingService({ activityRegistry: raceReg, sessionService: sessions });
    expect(await svc.enrichSession('20260612999999', 'household')).toEqual([]);
  });

  it('returns [] without an activity registry', async () => {
    const svc = new SessionGroupingService({ activityRegistry: null, sessionService: sessions });
    expect(await svc.enrichSession(SOLO, 'household')).toEqual([]);
  });
});
