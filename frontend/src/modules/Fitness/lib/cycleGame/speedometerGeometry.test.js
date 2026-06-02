import { describe, it, expect } from 'vitest';
import { buildTicks, buildBandArcs, needleAngleDeg, bandForRpm } from './speedometerGeometry.js';

const BANDS = [
  { id: 'warmup',   min: 0,  color: '#5b6470' },
  { id: 'cruising', min: 40, color: '#2ecc71' },
  { id: 'pushing',  min: 70, color: '#f1c40f' },
  { id: 'sprint',   min: 90, color: '#e74c3c' }
];

describe('buildTicks', () => {
  it('produces maxRpm/tickStep + 1 ticks, with majors at labelStep', () => {
    const ticks = buildTicks({ maxRpm: 120, tickStep: 10, labelStep: 30, center: 100, gaugeRadius: 80 });
    expect(ticks).toHaveLength(13);
    expect(ticks[0].rpm).toBe(0);
    expect(ticks[0].major).toBe(true);
    expect(ticks[0].label).toBe(0);
    expect(ticks.find(t => t.rpm === 30).major).toBe(true);
    expect(ticks.find(t => t.rpm === 20).major).toBe(false);
    expect(ticks.find(t => t.rpm === 20).label).toBeNull();
  });
  it('places the rpm=0 tick at the left edge', () => {
    const ticks = buildTicks({ maxRpm: 120, tickStep: 10, labelStep: 30, center: 100, gaugeRadius: 80 });
    const t0 = ticks[0];
    expect(t0.inner.x).toBeCloseTo(100 - (80 - 4), 3);
    expect(t0.inner.y).toBeCloseTo(100, 3);
  });
});

describe('buildBandArcs', () => {
  it('returns one arc per band that starts below maxRpm, each with color + path', () => {
    const arcs = buildBandArcs({ bands: BANDS, maxRpm: 120, center: 100, gaugeRadius: 80 });
    expect(arcs).toHaveLength(4);
    expect(arcs[0].id).toBe('warmup');
    expect(arcs[0].color).toBe('#5b6470');
    expect(arcs[0].d.startsWith('M ')).toBe(true);
    expect(arcs[0].d).toContain(' A 80 80 ');
  });
  it('drops bands whose min is at/above maxRpm', () => {
    const arcs = buildBandArcs({ bands: [...BANDS, { id: 'over', min: 130, color: '#fff' }], maxRpm: 120, center: 100, gaugeRadius: 80 });
    expect(arcs.map(a => a.id)).not.toContain('over');
  });
});

describe('needleAngleDeg', () => {
  it('maps rpm to a -90..+90 degree sweep (0 → -90, half → 0, max → +90)', () => {
    expect(needleAngleDeg(0, 120)).toBeCloseTo(-90, 3);
    expect(needleAngleDeg(60, 120)).toBeCloseTo(0, 3);
    expect(needleAngleDeg(120, 120)).toBeCloseTo(90, 3);
  });
  it('clamps out-of-range rpm to the endpoints', () => {
    expect(needleAngleDeg(-10, 120)).toBeCloseTo(-90, 3);
    expect(needleAngleDeg(999, 120)).toBeCloseTo(90, 3);
  });
});

describe('bandForRpm', () => {
  it('returns the band whose [min, nextMin) contains the rpm', () => {
    expect(bandForRpm(0, BANDS).id).toBe('warmup');
    expect(bandForRpm(50, BANDS).id).toBe('cruising');
    expect(bandForRpm(70, BANDS).id).toBe('pushing');
    expect(bandForRpm(95, BANDS).id).toBe('sprint');
  });
  it('clamps below the first band to the first band', () => {
    expect(bandForRpm(-5, BANDS).id).toBe('warmup');
  });
  it('returns null for empty bands', () => {
    expect(bandForRpm(50, [])).toBeNull();
  });
});
