import { describe, it, expect } from 'vitest';
import { normalizeKind } from '../../../../../backend/src/3_applications/agents/health-coach/services/EventQueryService.mjs';

describe('normalizeKind', () => {
  it('maps runs', () => {
    for (const t of ['Run', 'TrailRun', 'VirtualRun']) expect(normalizeKind(t)).toBe('run');
  });
  it('maps cycles', () => {
    for (const t of ['Ride', 'VirtualRide', 'EBikeRide', 'GravelRide', 'MountainBikeRide']) expect(normalizeKind(t)).toBe('cycle');
  });
  it('maps strength', () => {
    for (const t of ['WeightTraining', 'Crossfit', 'Workout']) expect(normalizeKind(t)).toBe('strength');
  });
  it('maps walks', () => {
    for (const t of ['Walk', 'Hike']) expect(normalizeKind(t)).toBe('walk');
  });
  it('maps yoga / swim', () => {
    expect(normalizeKind('Yoga')).toBe('yoga');
    expect(normalizeKind('Swim')).toBe('swim');
  });
  it('maps null/unknown to other', () => {
    expect(normalizeKind(null)).toBe('other');
    expect(normalizeKind('AlpineSki')).toBe('other');
  });
});
