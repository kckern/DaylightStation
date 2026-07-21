import { describe, it, expect } from 'vitest';
import { sortByZoneRank, ZONE_RANK_MAP } from './ParticipantFactory.js';

const p = (over) => ({
  id: 'p', name: 'p', rawZoneId: 'active', zoneProgress: 0, isActive: true, ...over,
});

describe('ZONE_RANK_MAP', () => {
  it('ranks the five canonical zones coolest to hottest', () => {
    expect(ZONE_RANK_MAP).toEqual({ cool: 0, active: 1, warm: 2, hot: 3, fire: 4 });
  });
});

describe('sortByZoneRank', () => {
  it('REGRESSION 2026-07-21: within one zone, higher progress wins regardless of raw BPM', () => {
    // Felix 127 BPM @ 1/3 through active; Dad 115 BPM @ 2/3 through active.
    // Dad must be on top — the sidebar showed the reverse when Dad's progress
    // lookup missed on his group label and degraded to 0.
    const felix = p({ id: 'user_4', name: 'Felix', zoneProgress: 0.33, heartRate: 127 });
    const dad = p({ id: 'user_1', name: 'Kevin', zoneProgress: 0.66, heartRate: 115 });
    expect(sortByZoneRank([felix, dad]).map((x) => x.id)).toEqual(['user_1', 'user_4']);
  });

  it('ranks a hotter zone above a cooler one regardless of progress', () => {
    const warmLow = p({ id: 'warm', rawZoneId: 'warm', zoneProgress: 0.01 });
    const activeHigh = p({ id: 'active', rawZoneId: 'active', zoneProgress: 0.99 });
    expect(sortByZoneRank([activeHigh, warmLow]).map((x) => x.id)).toEqual(['warm', 'active']);
  });

  it('sorts on the RAW zone, not the hysteresis-smoothed committed zone', () => {
    // Committed zone would order these backwards; raw must win.
    const a = p({ id: 'a', rawZoneId: 'hot', zoneId: 'cool' });
    const b = p({ id: 'b', rawZoneId: 'cool', zoneId: 'hot' });
    expect(sortByZoneRank([b, a]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('falls back to committed zoneId when rawZoneId is absent', () => {
    const a = p({ id: 'a', rawZoneId: null, zoneId: 'fire' });
    const b = p({ id: 'b', rawZoneId: null, zoneId: 'cool' });
    expect(sortByZoneRank([b, a]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('sinks zoneless participants to the bottom', () => {
    const none = p({ id: 'none', rawZoneId: null, zoneId: null });
    const cool = p({ id: 'cool', rawZoneId: 'cool' });
    expect(sortByZoneRank([none, cool]).map((x) => x.id)).toEqual(['cool', 'none']);
  });

  it('is case-insensitive on zone ids', () => {
    const a = p({ id: 'a', rawZoneId: 'FIRE' });
    const b = p({ id: 'b', rawZoneId: 'cool' });
    expect(sortByZoneRank([b, a]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('breaks progress ties with active before inactive', () => {
    const inactive = p({ id: 'inactive', isActive: false, zoneProgress: 0.5 });
    const active = p({ id: 'active', isActive: true, zoneProgress: 0.5 });
    expect(sortByZoneRank([inactive, active]).map((x) => x.id)).toEqual(['active', 'inactive']);
  });

  it('is deterministic on a total tie, via id', () => {
    const b = p({ id: 'bbb' });
    const a = p({ id: 'aaa' });
    expect(sortByZoneRank([b, a]).map((x) => x.id)).toEqual(['aaa', 'bbb']);
  });

  it('treats a null/NaN zoneProgress as 0 rather than throwing', () => {
    const nullProg = p({ id: 'null', zoneProgress: null });
    const real = p({ id: 'real', zoneProgress: 0.2 });
    expect(sortByZoneRank([nullProg, real]).map((x) => x.id)).toEqual(['real', 'null']);
  });

  it('does not mutate the input array', () => {
    const input = [p({ id: 'b', zoneProgress: 0.1 }), p({ id: 'a', zoneProgress: 0.9 })];
    const before = input.map((x) => x.id);
    sortByZoneRank(input);
    expect(input.map((x) => x.id)).toEqual(before);
  });

  it('returns an empty array for a non-array input', () => {
    expect(sortByZoneRank(null)).toEqual([]);
  });
});
