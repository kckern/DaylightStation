import { describe, it, expect, vi } from 'vitest';
import { PersistenceManager } from './PersistenceManager.js';

const START = 1800000000000;
const state = (at, run, observation, value) => ({ type: 'playback_state', timestamp: START + at, data: {
  version: 1, contentId: 'video:1', playbackRunId: run, observation, state: value,
  reason: 'startup_gate', mediaTimeSeconds: 0, governancePhase: 'pending',
  evidence: { participantId: 'child', hrBpm: 165, thresholdBpm: 160, zone: 'hot', challengeId: null },
} });
const payload = (events, durationMs) => ({ sessionId: 'fs_20270115080000', startTime: START, endTime: START + durationMs, durationMs,
  roster: [{ userId: 'child' }], deviceAssignments: [{ deviceId: 'sensor-1' }], tickCount: 100,
  timeline: { series: { 'user:child:hr': Array(100).fill(130) }, timebase: { tickCount: 100 }, events },
});

describe('playback-state persistence', () => {
  it('preserves coverage and evidence before media_start and across runs through provisional/final saves', async () => {
    const persistApi = vi.fn().mockResolvedValue({ ok: true, granted: true });
    const pm = new PersistenceManager({ persistApi });
    const observations = [state(0, 'r1', 'begin', 'waiting'), state(45000, 'r1', 'change', 'playing'), state(60000, 'r1', 'end', 'none'),
      state(61000, 'r2', 'begin', 'unknown'), state(62000, 'r2', 'change', 'playing'), state(65000, 'r2', 'change', 'governance_paused'), state(80000, 'r2', 'end', 'none')];
    const events = [...observations,
      { type: 'media_start', timestamp: START + 10000, data: { contentId: 'video:1', title: 'Episode', type: 'episode' } },
      { type: 'media_end', timestamp: START + 80000, data: { contentId: 'video:1' } },
      { type: 'challenge_start', timestamp: START + 20000, data: { challengeId: 'challenge:1', zone: 'warm' } },
      { type: 'challenge_end', timestamp: START + 30000, data: { challengeId: 'challenge:1', result: 'success' } },
    ];
    for (const durationMs of [90000, 360000]) {
      pm.persistSession(payload(structuredClone(events), durationMs), { force: true });
      await pm.whenLastSaveSettled();
    }
    const saves = persistApi.mock.calls.filter(([url]) => url === 'api/v1/fitness/save_session').map(([, body]) => body.sessionData);
    expect(saves).toHaveLength(2);
    for (const saved of saves) {
      expect(saved.timeline.events.filter(e => e.type === 'playback_state')).toEqual(observations);
      expect(saved.timeline.events.filter(e => e.type === 'media')).toHaveLength(1);
      expect(saved.timeline.events.filter(e => e.type === 'challenge')).toHaveLength(1);
    }
    expect(saves[0].provisional).toBe(true);
    expect(saves[1].provisional).toBeFalsy();
  });
});
