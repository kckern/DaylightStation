import { describe, it, expect } from 'vitest';
import { getChallengeTypeDisplay, resolveChallengeMarkerType, getChallengeMarkerColor } from './challengeTypeRegistry.js';
import { ZONE_COLOR_MAP } from '@/modules/Fitness/lib/chartHelpers.js';

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

describe('getChallengeMarkerColor', () => {
  it('tints a zone challenge by its zone (warm vs hot differ)', () => {
    const warm = getChallengeMarkerColor({ type: 'zone', zoneId: 'warm' });
    const hot = getChallengeMarkerColor({ type: 'zone', zoneId: 'hot' });
    expect(warm).toBe(ZONE_COLOR_MAP.warm);
    expect(hot).toBe(ZONE_COLOR_MAP.hot);
    expect(warm).not.toBe(hot);
  });
  it('uses the cycle type color for cycle challenges', () => {
    expect(getChallengeMarkerColor({ type: 'cycle', zoneId: null })).toBe(getChallengeTypeDisplay('cycle').color);
  });
  it('falls back to the zone type color when zoneId is unknown', () => {
    expect(getChallengeMarkerColor({ type: 'zone', zoneId: 'nope' })).toBe(getChallengeTypeDisplay('zone').color);
  });
});
