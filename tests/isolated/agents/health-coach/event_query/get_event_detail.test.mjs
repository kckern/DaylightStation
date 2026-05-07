// tests/isolated/agents/health-coach/event_query/get_event_detail.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { EventQueryService } from '../../../../../backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs';

function makeSession({ sessionId, startTime, durationMs, stravaId = null, hr_series = null }) {
  return {
    sessionId,
    startTime,
    durationMs,
    strava: stravaId ? { id: stravaId, type: 'Run', name: 'Morning Run' } : null,
    metadata: { hr_avg: 142, hr_max: 175, distance_mi: 4.2, kcal: 380 },
    timeline: hr_series ? { series: { kc: hr_series }, events: [] } : { series: {}, events: [] },
    strava_notes: null,
  };
}

describe('EventQueryService.getEventDetail', () => {
  it('returns full record when found by sessionId', async () => {
    const session = makeSession({
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 38 * 60_000,
      stravaId: 12345, hr_series: [120, 125, 130, 135, 140, 145, 150],
    });
    const svc = new EventQueryService({
      sessionService: {
        listSessionsInRange: vi.fn(async () => []),
        getById: vi.fn(async () => session),
      },
      householdId: 'kckern',
    });
    const r = await svc.getEventDetail({ id: '20260507060000' });
    expect(r.session_id).toBe('20260507060000');
    expect(r.strava_id).toBe(12345);
    expect(r.timeline.series.kc).toEqual([120, 125, 130, 135, 140, 145, 150]);
  });

  it('falls back to findByStravaId when sessionService.getById returns null', async () => {
    const session = makeSession({
      sessionId: '20260507060000', startTime: '2026-05-07T06:00:00Z', durationMs: 38 * 60_000,
      stravaId: 12345,
    });
    const svc = new EventQueryService({
      sessionService: {
        listSessionsInRange: vi.fn(async () => []),
        getById: vi.fn(async () => null),
        findByStravaId: vi.fn(async (id) => id === 12345 ? session : null),
      },
      householdId: 'kckern',
    });
    const r = await svc.getEventDetail({ id: 12345 });
    expect(r.strava_id).toBe(12345);
  });

  it('returns error envelope when not found', async () => {
    const svc = new EventQueryService({
      sessionService: {
        listSessionsInRange: vi.fn(async () => []),
        getById: vi.fn(async () => null),
        findByStravaId: vi.fn(async () => null),
      },
      householdId: 'kckern',
    });
    const r = await svc.getEventDetail({ id: 'unknown' });
    expect(r.error).toMatch(/not found/);
  });

  it('rejects when id missing', async () => {
    const svc = new EventQueryService({ sessionService: {}, householdId: 'kckern' });
    await expect(svc.getEventDetail({})).rejects.toThrow(/id/);
  });
});
