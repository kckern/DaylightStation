import { describe, it, expect } from 'vitest';
import { SessionGroupingService } from './SessionGroupingService.mjs';

const T0 = Date.parse('2026-06-05T16:22:00-07:00');
const tl = (ticks, val) => ({ series: { milo: Array(ticks).fill(val) }, events: [], tick_count: ticks, interval_seconds: 5 });

// two no-video sessions that groupSessions will merge (overlap on milo); 10-min idle gap
const s1 = { sessionId: '20260605162200', date: '2026-06-05', startTime: T0, durationMs: 15000, participants: { milo: { displayName: 'milo' }, alan: { displayName: 'alan' } }, media: null, totalCoins: 100 };
const s2 = { sessionId: '20260605163000', date: '2026-06-05', startTime: T0 + 600000, durationMs: 10000, participants: { milo: { displayName: 'milo' } }, media: null, totalCoins: 50 };

const sessionService = {
  resolveHouseholdId: () => 'household',
  listSessionsByDate: async () => [ { ...s1 }, { ...s2 } ],
  getSession: async (id) => ({ timeline: id === s1.sessionId ? tl(3, 'a') : tl(2, 'b') }),
};

// one race inside s2, 2s after it starts, lasting 3s
const registry = { enrich: async () => [{ type: 'cycle-game', count: 1,
  items: [{ startMs: s2.startTime + 2000, endMs: s2.startTime + 5000, participants: ['milo'], meta: { winnerId: 'milo' } }] }] };

describe('SessionGroupingService.getGroupDetail', () => {
  it('stitches member timelines, compresses the gap, and emits a seam', async () => {
    const svc = new SessionGroupingService({ activityRegistry: registry, sessionService });
    const detail = await svc.getGroupDetail('group:20260605162200', 'household');
    expect(detail.isGroup).toBe(true);
    expect(detail.date).toBe('2026-06-05');
    expect(detail.timeline.tick_count).toBe(5);                 // 3 + 0 + 2 (no null filler)
    expect(detail.timeline.series.milo).toEqual(['a','a','a','b','b']);
    expect(detail.segments.map(s => s.offsetMs)).toEqual([0, 15000]); // 3 ticks * 5s
    expect(detail.seams).toEqual([{ atMs: 15000, gapMs: 585000 }]);   // gap = 600000 - 15000
    expect(detail.media).toBeNull();
    expect(Object.keys(detail.participants).sort()).toEqual(['alan','milo']);
  });

  it('rebases activity bands onto the compressed axis', async () => {
    const svc = new SessionGroupingService({ activityRegistry: registry, sessionService });
    const detail = await svc.getGroupDetail('group:20260605162200', 'household');
    const band = detail.activities[0].items[0];
    expect(band.axisStartMs).toBe(15000 + 2000); // s2 offset + 2s into s2
    expect(band.axisEndMs).toBe(15000 + 5000);
  });

  it('returns null for an unknown group id', async () => {
    const svc = new SessionGroupingService({ activityRegistry: registry, sessionService });
    expect(await svc.getGroupDetail('group:20991231000000', 'household')).toBeNull();
  });
});
