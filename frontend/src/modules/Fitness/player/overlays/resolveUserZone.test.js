import { describe, it, expect } from 'vitest';
import { resolveUserZone, canonicalZones } from './resolveUserZone.js';

const ZONES = [
  { id: 'cool', min: 0, color: '#3b82f6' },
  { id: 'active', min: 100, color: '#22c55e' },
  { id: 'warm', min: 120, color: '#eab308' },
  { id: 'hot', min: 150, color: '#f97316' },
  { id: 'fire', min: 170, color: '#ef4444' }
];

describe('resolveUserZone', () => {
  it('exports the canonical zone list', () => {
    expect(canonicalZones).toEqual(['cool', 'active', 'warm', 'hot', 'fire']);
  });

  it('derives an HR-based zone for an UNMAPPED device (no userName) — the guest bug', () => {
    const zone = resolveUserZone(null, { heartRate: 130 }, {
      userCurrentZones: {}, zones: ZONES, usersConfigRaw: {}
    });
    expect(zone).toEqual({ id: 'warm', color: '#eab308' });
  });

  it('still resolves the committed zone for a mapped user', () => {
    const zone = resolveUserZone('Felix', { heartRate: 0 }, {
      userCurrentZones: { Felix: { id: 'fire', color: '#ff0000' } },
      zones: ZONES, usersConfigRaw: {}
    });
    expect(zone).toEqual({ id: 'fire', color: '#ff0000' });
  });

  it('applies per-user threshold overrides when a user is mapped', () => {
    const zone = resolveUserZone('Milo', { heartRate: 130 }, {
      userCurrentZones: {}, zones: ZONES,
      usersConfigRaw: { primary: [{ name: 'Milo', zones: { warm: 999 } }] }
    });
    // warm override is 999 → 130 falls back to the next-lower canonical zone (active@100)
    expect(zone.id).toBe('active');
  });

  it('returns null id / null color when there is no HR and no committed zone', () => {
    const zone = resolveUserZone(null, { heartRate: 0 }, {
      userCurrentZones: {}, zones: ZONES, usersConfigRaw: {}
    });
    expect(zone).toEqual({ id: null, color: null });
  });
});
