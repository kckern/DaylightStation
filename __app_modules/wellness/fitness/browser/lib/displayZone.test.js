import { describe, it, expect } from 'vitest';
import { displayZoneRecord } from './displayZone.js';

const LADDER = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue' },
  { id: 'active', name: 'Active', min: 100, color: 'green' },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow' },
  { id: 'hot', name: 'Hot', min: 140, color: 'orange' },
  { id: 'fire', name: 'Fire', min: 160, color: 'red' },
];

describe('displayZoneRecord', () => {
  it('colour and bar describe the same zone: the one the BPM is in', () => {
    expect(displayZoneRecord({ heartRate: 130, ladder: LADDER })).toEqual({
      zoneId: 'warm', zoneName: 'Warm', zoneColor: 'yellow', progress: 0.5, showBar: true, max: false, live: true,
    });
  });

  it('ignores a committed zone held by the exit margin while there is a reading', () => {
    // Committed Hot (floor 140), HR 137: Warm, 85% of the Warm band.
    const r = displayZoneRecord({ heartRate: 137, ladder: LADDER, committedZoneId: 'hot', committedZoneColor: 'orange' });
    expect(r.zoneId).toBe('warm');
    expect(r.zoneColor).toBe('yellow');
    expect(r.progress).toBeCloseTo(0.85, 5);
  });

  it('shows a crossing at once, before the store confirms it', () => {
    const r = displayZoneRecord({ heartRate: 141, ladder: LADDER, committedZoneId: 'warm' });
    expect(r.zoneId).toBe('hot');
    expect(r.progress).toBeCloseTo(0.05, 5);
  });

  it('reads the BPM as printed: 159.6 shows "160" and is Fire', () => {
    expect(displayZoneRecord({ heartRate: 159.6, ladder: LADDER }).zoneId).toBe('fire');
    expect(displayZoneRecord({ heartRate: 159.4, ladder: LADDER }).zoneId).toBe('hot');
  });

  it('Fire is a full, max bar', () => {
    expect(displayZoneRecord({ heartRate: 171, ladder: LADDER })).toMatchObject({ zoneId: 'fire', progress: 1, showBar: true, max: true });
  });

  it('a committed Fire under the Fire floor is not shown as Fire', () => {
    expect(displayZoneRecord({ heartRate: 157, ladder: LADDER, committedZoneId: 'fire' })).toMatchObject({ zoneId: 'hot', max: false });
  });

  it('uses the validated ladder over the fallback', () => {
    const fallback = LADDER.map((z) => (z.id === 'hot' ? { ...z, min: 130 } : z));
    expect(displayZoneRecord({ heartRate: 135, ladder: LADDER, fallbackLadder: fallback }).zoneId).toBe('warm');
    expect(displayZoneRecord({ heartRate: 135, ladder: null, fallbackLadder: fallback }).zoneId).toBe('hot');
  });

  it('no reading: holds the committed zone, with no bar to measure', () => {
    expect(displayZoneRecord({ heartRate: null, ladder: LADDER, committedZoneId: 'Warm', committedZoneColor: 'yellow' })).toEqual({
      zoneId: 'warm', zoneName: 'warm', zoneColor: 'yellow', progress: null, showBar: false, max: false, live: false,
    });
    expect(displayZoneRecord({ heartRate: 0, ladder: LADDER, committedZoneId: 'fire' })).toMatchObject({ zoneId: 'fire', showBar: true, progress: 1, max: true, live: false });
  });

  it('no reading and nothing held: no zone', () => {
    expect(displayZoneRecord({ heartRate: null, ladder: LADDER })).toMatchObject({ zoneId: null, zoneColor: null, showBar: false });
    expect(displayZoneRecord()).toMatchObject({ zoneId: null, live: false });
  });

  it('a reading with no ladder at all falls back to the held zone', () => {
    expect(displayZoneRecord({ heartRate: 150, committedZoneId: 'warm' })).toMatchObject({ zoneId: 'warm', live: false, showBar: false });
  });
});
