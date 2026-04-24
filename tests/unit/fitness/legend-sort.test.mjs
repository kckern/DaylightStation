// tests/unit/fitness/legend-sort.test.mjs
import { describe, it, expect } from '@jest/globals';
import { compareLegendEntries } from '#frontend/modules/Fitness/widgets/FitnessChart/layout/utils/sort.js';

// Shape the comparator expects (the relevant fields from an allEntries[i]-derived
// legend entry). Extra fields (name, avatarUrl, color) are ignored.
const entry = (overrides) => ({
  id: 'alice',
  zoneIndex: 0,
  progress: 0,
  heartRate: 0,
  ...overrides
});

describe('compareLegendEntries', () => {
  it('sorts by zoneIndex DESC first (higher zone on top)', () => {
    const a = entry({ id: 'a', zoneIndex: 2, progress: 0.1, heartRate: 150 });
    const b = entry({ id: 'b', zoneIndex: 1, progress: 0.9, heartRate: 180 });
    expect([b, a].sort(compareLegendEntries).map(e => e.id)).toEqual(['a', 'b']);
  });

  it('within the same zone, sorts by progress DESC', () => {
    // Warm zone, different per-user thresholds — a is 80% through, b is 20%.
    // b has a higher raw HR but is newer to the zone.
    const a = entry({ id: 'a', zoneIndex: 2, progress: 0.8, heartRate: 140 });
    const b = entry({ id: 'b', zoneIndex: 2, progress: 0.2, heartRate: 160 });
    expect([b, a].sort(compareLegendEntries).map(e => e.id)).toEqual(['a', 'b']);
  });

  it('within same zone and same progress, sorts by heartRate DESC', () => {
    const a = entry({ id: 'a', zoneIndex: 2, progress: 0.5, heartRate: 150 });
    const b = entry({ id: 'b', zoneIndex: 2, progress: 0.5, heartRate: 155 });
    expect([a, b].sort(compareLegendEntries).map(e => e.id)).toEqual(['b', 'a']);
  });

  it('final tiebreak is id ASC (deterministic)', () => {
    const a = entry({ id: 'zeb',   zoneIndex: 1, progress: 0.3, heartRate: 120 });
    const b = entry({ id: 'alice', zoneIndex: 1, progress: 0.3, heartRate: 120 });
    expect([a, b].sort(compareLegendEntries).map(e => e.id)).toEqual(['alice', 'zeb']);
  });

  it('treats missing progress/zoneIndex/heartRate as 0 (stable for offline users)', () => {
    const active  = entry({ id: 'active',  zoneIndex: 1, progress: 0.5, heartRate: 140 });
    const offline = entry({ id: 'offline', zoneIndex: undefined, progress: undefined, heartRate: undefined });
    expect([offline, active].sort(compareLegendEntries).map(e => e.id)).toEqual(['active', 'offline']);
  });

  it('is a proper comparator — produces a stable total order across permutations', () => {
    const entries = [
      entry({ id: 'a', zoneIndex: 2, progress: 0.8, heartRate: 140 }),
      entry({ id: 'b', zoneIndex: 2, progress: 0.2, heartRate: 160 }),
      entry({ id: 'c', zoneIndex: 1, progress: 0.9, heartRate: 130 }),
      entry({ id: 'd', zoneIndex: 1, progress: 0.9, heartRate: 130 }), // tie with c on 3 keys; id breaks
      entry({ id: 'e', zoneIndex: 0, progress: 0,   heartRate: 70  }),
    ];
    const sorted1 = [...entries].sort(compareLegendEntries).map(e => e.id);
    const sorted2 = [...entries].reverse().sort(compareLegendEntries).map(e => e.id);
    expect(sorted1).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(sorted2).toEqual(sorted1);
  });
});
