import { describe, it, expect } from 'vitest';
import { boostState, boostRange } from './boostState.js';

const zones = [
  { id: 'cool', name: 'Cool', distance_multiplier: 0.8 }, { id: 'active', name: 'Active', distance_multiplier: 1 },
  { id: 'warm', name: 'Warm', distance_multiplier: 1.2 }, { id: 'hot', name: 'Hot', distance_multiplier: 1.4 },
  { id: 'fire', name: 'Fire', distance_multiplier: 1.6 }
];
describe('boostState', () => {
  it('names the zone, its multiplier and the next step', () => {
    expect(boostState({ zoneId: 'WARM', zones, progress: 0.4 })).toEqual({
      hasStrap: true, label: 'Warm', mult: 1.2, progress: 0.4, next: { label: 'Hot', mult: 1.4 }
    });
  });
  it('top zone has no next', () => expect(boostState({ zoneId: 'fire', zones }).next).toBeNull());
  it('no zone means no strap, at the strapless multiplier', () => {
    expect(boostState({ zoneId: null, zones, hrlessMultiplier: 0.8 })).toEqual({
      hasStrap: false, label: 'No heart-rate strap', mult: 0.8, progress: null, next: null
    });
  });

  it('sorts zones by distance_multiplier ascending before the lookup', () => {
    const shuffled = [zones[3], zones[0], zones[4], zones[2], zones[1]];
    const s = boostState({ zoneId: 'warm', zones: shuffled });
    expect(s.next).toEqual({ label: 'Hot', mult: 1.4 });
    expect(boostState({ zoneId: 'fire', zones: shuffled }).next).toBeNull();
    expect(boostState({ zoneId: 'cool', zones: shuffled }).next).toEqual({ label: 'Active', mult: 1 });
  });
  it('does not mutate the zones it is given', () => {
    const shuffled = [zones[1], zones[0]];
    boostState({ zoneId: 'cool', zones: shuffled });
    expect(shuffled[0].id).toBe('active');
  });
  it('a zone with no name gets a title-cased id', () => {
    const s = boostState({ zoneId: 'blaze', zones: [{ id: 'blaze', distance_multiplier: 1.5 }, { id: 'ember', distance_multiplier: 1.7 }] });
    expect(s.label).toBe('Blaze');
    expect(s.next.label).toBe('Ember');
  });
  it('zones null/undefined behaves as no strap', () => {
    for (const z of [null, undefined]) {
      expect(boostState({ zoneId: 'warm', zones: z, hrlessMultiplier: 0.9 })).toEqual({
        hasStrap: false, label: 'No heart-rate strap', mult: 0.9, progress: null, next: null
      });
    }
    expect(boostState().hasStrap).toBe(false);
  });
  it('clamps progress to 0..1', () => {
    expect(boostState({ zoneId: 'warm', zones, progress: 1.7 }).progress).toBe(1);
    expect(boostState({ zoneId: 'warm', zones, progress: -0.3 }).progress).toBe(0);
    expect(boostState({ zoneId: 'warm', zones, progress: NaN }).progress).toBeNull();
  });
  it('a non-finite hrlessMultiplier falls back to 1', () => {
    for (const m of [NaN, Infinity, undefined, 'x']) {
      expect(boostState({ zoneId: null, zones, hrlessMultiplier: m }).mult).toBe(1);
    }
  });
  it('a zone without a finite multiplier counts as 1', () => {
    expect(boostState({ zoneId: 'a', zones: [{ id: 'a' }] }).mult).toBe(1);
  });
});

describe('boostRange', () => {
  it('spans zone multipliers and the strapless one', () => {
    expect(boostRange(zones, 0.8)).toEqual({ min: 0.8, max: 1.6 });
    expect(boostRange(zones, 0.5)).toEqual({ min: 0.5, max: 1.6 });
    expect(boostRange(zones, 2)).toEqual({ min: 0.8, max: 2 });
  });
  it('empty zone list yields just the strapless multiplier', () => {
    expect(boostRange([], 0.8)).toEqual({ min: 0.8, max: 0.8 });
    expect(boostRange(null, 0.8)).toEqual({ min: 0.8, max: 0.8 });
    expect(boostRange(undefined)).toEqual({ min: 1, max: 1 });
  });
  it('non-finite strapless falls back to 1; bad zone multipliers are ignored', () => {
    expect(boostRange([{ id: 'a', distance_multiplier: 1.3 }, { id: 'b' }, null], NaN)).toEqual({ min: 1, max: 1.3 });
  });
});
