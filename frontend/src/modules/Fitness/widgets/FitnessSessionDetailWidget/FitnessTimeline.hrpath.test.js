import { describe, it, expect } from 'vitest';
import { buildHrAreaPath } from './FitnessTimeline.jsx';

describe('buildHrAreaPath stats', () => {
  const zones = ['active', 'active', 'active', 'active', 'active'];
  it('reports hrMax, hrMin, and lastActiveTick for a simple series', () => {
    const hr = [100, 120, 150, 130, 110];
    const r = buildHrAreaPath(hr, zones, 5, 100, 0, 50, 5000);
    expect(r.hrMax).toBe(150);
    expect(r.hrMin).toBe(100);
    expect(r.lastActiveTick).toBe(4);
    expect(Array.isArray(r.fills)).toBe(true);
  });
  it('lastActiveTick is the final tick with HR for a rider who left early', () => {
    const hr = [100, 120, 130, null, null];
    const r = buildHrAreaPath(hr, zones, 5, 100, 0, 50, 5000);
    expect(r.lastActiveTick).toBe(2);
  });
  it('returns empty stats for an all-null series', () => {
    const r = buildHrAreaPath([null, null], ['active', 'active'], 2, 100, 0, 50, 5000);
    expect(r.fills).toEqual([]);
    expect(r.lastActiveTick).toBe(-1);
  });
});
