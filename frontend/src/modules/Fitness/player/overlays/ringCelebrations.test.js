import { describe, expect, it } from 'vitest';
import {
  createRingCelebrationTracker,
  normalizeRingCelebrationsConfig,
  ringCelebrationsForAward,
  seedRingCelebrationTracker,
} from './ringCelebrations.js';

describe('ring celebrations', () => {
  const config = {
    enabled: true,
    individual: { thresholds: [100, 200] },
    group: { thresholds: [500, 1000], min_contributors: 2 },
  };

  it('normalizes invalid values into safe configurable defaults', () => {
    const normalized = normalizeRingCelebrationsConfig({
      duration_ms: 25,
      volume: 4,
      individual: { thresholds: [250, 100, 100, -1, 'bad'] },
    });
    expect(normalized.durationMs).toBe(1000);
    expect(normalized.volume).toBe(1);
    expect(normalized.individual.thresholds).toEqual([100, 250]);
    expect(normalized.enabled).toBe(false);
  });

  it('uses the built-in icon when a household does not supply a media image', () => {
    expect(normalizeRingCelebrationsConfig({ icon: null }).icon).toBeNull();
    expect(normalizeRingCelebrationsConfig({ icon: 'none' }).icon).toBeNull();
    expect(normalizeRingCelebrationsConfig({ icon: 'fitness/custom-ring.svg' }).icon)
      .toBe('fitness/custom-ring.svg');
  });

  it('fires individual thresholds once, including a multi-threshold jump', () => {
    const first = ringCelebrationsForAward(createRingCelebrationTracker(), {
      userId: 'milo', userTotal: 250, totalRings: 250,
    }, config);
    expect(first.entries.map((entry) => entry.threshold)).toEqual([100, 200]);

    const second = ringCelebrationsForAward(first.tracker, {
      userId: 'milo', userTotal: 250, totalRings: 250,
    }, config);
    expect(second.entries).toEqual([]);
  });

  it('requires two actual ring earners before celebrating a group total', () => {
    const first = ringCelebrationsForAward(createRingCelebrationTracker(), {
      userId: 'milo', userTotal: 500, totalRings: 500,
    }, config);
    expect(first.entries.filter((entry) => entry.scope === 'group')).toEqual([]);

    const second = ringCelebrationsForAward(first.tracker, {
      userId: 'felix', userTotal: 1, totalRings: 501,
    }, config);
    expect(second.entries.filter((entry) => entry.scope === 'group')).toMatchObject([
      { threshold: 500, contributorIds: ['milo', 'felix'] },
    ]);
  });

  it('seeding a resumed session suppresses thresholds already earned', () => {
    const seeded = seedRingCelebrationTracker(createRingCelebrationTracker(), {
      userTotals: new Map([['milo', 200], ['felix', 400]]),
      totalRings: 600,
    }, config);
    const result = ringCelebrationsForAward(seeded, {
      userId: 'milo', userTotal: 201, totalRings: 601,
    }, config);
    expect(result.entries).toEqual([]);
  });
});
