import { describe, it, expect } from 'vitest';
import { getChallengeTypeDisplay, resolveChallengeMarkerType } from './challengeTypeRegistry.js';

describe('getChallengeTypeDisplay', () => {
  it('returns the cycle descriptor', () => {
    const d = getChallengeTypeDisplay('cycle');
    expect(d.label).toBe('Cycle');
    expect(d.icon).toBe('🚴');
    expect(typeof d.color).toBe('string');
  });
  it('returns the zone descriptor', () => {
    expect(getChallengeTypeDisplay('zone').label).toBe('Zone');
  });
  it('falls back to a generic descriptor for unknown types', () => {
    const d = getChallengeTypeDisplay('mystery');
    expect(d).toBeTruthy();
    expect(typeof d.color).toBe('string');
  });
});

describe('resolveChallengeMarkerType', () => {
  it('prefers an explicit persisted type', () => {
    expect(resolveChallengeMarkerType({ data: { type: 'cycle', zoneId: 'warm' } })).toBe('cycle');
  });
  it('heuristically treats a missing zoneId as cycle (legacy events)', () => {
    expect(resolveChallengeMarkerType({ data: { type: null, zoneId: null } })).toBe('cycle');
  });
  it('heuristically treats a present zoneId as zone (legacy events)', () => {
    expect(resolveChallengeMarkerType({ data: { type: null, zoneId: 'warm' } })).toBe('zone');
  });
});
