import { describe, it, expect } from 'vitest';
import { buildCadenceConfig, DEFAULT_CADENCE_CONFIG } from './cadenceZones.js';

const SYSTEM = [
  { id: 'warmup',   name: 'Warm-up',  min: 0,  color: '#5b6470' },
  { id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' },
  { id: 'pushing',  name: 'Pushing',  min: 70, color: '#f1c40f' },
  { id: 'sprint',   name: 'Sprint',   min: 90, color: '#e74c3c' }
];

describe('buildCadenceConfig', () => {
  it('falls back to DEFAULT when no system zones given', () => {
    const out = buildCadenceConfig(undefined, undefined);
    expect(out).toHaveLength(DEFAULT_CADENCE_CONFIG.length);
    expect(out[0].id).toBe('warmup');
    expect(out.map(b => b.id)).toEqual(['warmup', 'cruising', 'pushing', 'sprint']);
  });
  it('uses the system bands unchanged when no override', () => {
    const out = buildCadenceConfig(SYSTEM, undefined);
    expect(out.find(b => b.id === 'cruising')).toEqual({ id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' });
  });
  it('applies a per-user {id→min} override, keeping name/color from system', () => {
    const out = buildCadenceConfig(SYSTEM, { cruising: 50, pushing: 80, sprint: 105 });
    const cruising = out.find(b => b.id === 'cruising');
    expect(cruising.min).toBe(50);
    expect(cruising.color).toBe('#2ecc71');
    expect(out.find(b => b.id === 'pushing').min).toBe(80);
    expect(out.find(b => b.id === 'sprint').min).toBe(105);
    expect(out.find(b => b.id === 'warmup').min).toBe(0);
  });
  it('matches override keys case-insensitively and ignores non-numeric', () => {
    const out = buildCadenceConfig(SYSTEM, { CRUISING: 55, sprint: 'fast' });
    expect(out.find(b => b.id === 'cruising').min).toBe(55);
    expect(out.find(b => b.id === 'sprint').min).toBe(90);
  });
  it('returns bands sorted by min ascending', () => {
    const out = buildCadenceConfig(SYSTEM, { warmup: 200 });
    expect(out[out.length - 1].id).toBe('warmup');
  });
});
