import { describe, it, expect } from 'vitest';
import { computeParticipantStats } from '#domains/fitness/services/SessionStatsService.mjs';

describe('computeParticipantStats', () => {
  it('computes peak HR', () => {
    const stats = computeParticipantStats({
      hr: [100, 150, 120, null, 160],
      zones: ['cool', 'warm', 'warm', null, 'hot'],
      coins: [0, 5, 10, 10, 20],
      intervalSeconds: 5,
      participant: {},
    });
    expect(stats.peakHr).toBe(160);
  });

  it('computes avg HR', () => {
    const stats = computeParticipantStats({
      hr: [100, 200],
      zones: ['cool', 'hot'],
      coins: [0, 10],
      intervalSeconds: 5,
      participant: {},
    });
    expect(stats.avgHr).toBe(150);
  });

  it('computes zone seconds', () => {
    const stats = computeParticipantStats({
      hr: [100, 120, 140, 160],
      zones: ['cool', 'cool', 'warm', 'hot'],
      coins: [0, 0, 5, 10],
      intervalSeconds: 10,
      participant: {},
    });
    expect(stats.zoneSeconds.cool).toBe(20);
    expect(stats.zoneSeconds.warm).toBe(10);
    expect(stats.zoneSeconds.hot).toBe(10);
  });

  it('computes warm+ ratio', () => {
    const stats = computeParticipantStats({
      hr: [100, 120, 160, 180],
      zones: ['cool', 'active', 'warm', 'hot'],
      coins: [0, 0, 5, 10],
      intervalSeconds: 5,
      participant: {},
    });
    expect(stats.warmPlusRatio).toBe(0.5);
  });

  it('handles empty arrays', () => {
    const stats = computeParticipantStats({
      hr: [],
      zones: [],
      coins: [],
      intervalSeconds: 5,
      participant: {},
    });
    expect(stats.peakHr).toBeNull();
    expect(stats.avgHr).toBeNull();
    expect(stats.totalCoins).toBe(0);
  });
});
