import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
vi.mock('@/lib/kioskEnv.js', () => ({ isKioskEnv: () => true }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info() {}, debug() {}, warn() {} }) }) }));
vi.mock('../context/FitnessContext.jsx', () => ({ useFitness: () => ({}) }));

import { decidePresenceGate, normalizePresenceGateConfig } from './usePresenceGate.js';

const config = normalizePresenceGateConfig({ enabled: true, entity: 'binary_sensor.adult_home', gate: ['play', 'show'] });
const base = { kind: 'play', config, status: 'ready', grantUntil: 0, now: 1000, kiosk: true };
const home = { enabled: true, home: true, state: 'on', reason: null };
const away = { enabled: true, home: false, state: 'off', reason: null };

describe('decidePresenceGate', () => {
  it('no config / disabled / no entity → never required', () => {
    for (const raw of [undefined, { enabled: false, entity: 'x' }, { enabled: true }]) {
      expect(decidePresenceGate({ ...base, config: normalizePresenceGateConfig(raw), presence: away }))
        .toEqual({ required: false, settled: true, reason: 'disabled' });
    }
  });
  it('off the kiosk → not required', () => {
    expect(decidePresenceGate({ ...base, kiosk: false, presence: away }).required).toBe(false);
  });
  it('kind not in gate → not required', () => {
    const playOnly = normalizePresenceGateConfig({ enabled: true, entity: 'x', gate: ['play'] });
    expect(decidePresenceGate({ ...base, kind: 'show', config: playOnly, presence: away }).required).toBe(false);
  });
  it('home → not required; away → required', () => {
    expect(decidePresenceGate({ ...base, presence: home })).toMatchObject({ required: false, reason: 'home' });
    expect(decidePresenceGate({ ...base, presence: away })).toMatchObject({ required: true, settled: true, reason: 'away' });
  });
  it('unknown/unavailable, fetch error, or server reporting disabled while config is on → required (fail closed)', () => {
    expect(decidePresenceGate({ ...base, presence: { ...away, state: 'unknown', reason: 'unavailable' } }))
      .toMatchObject({ required: true, reason: 'sensor_unavailable' });
    expect(decidePresenceGate({ ...base, status: 'error', presence: null })).toMatchObject({ required: true, reason: 'sensor_unavailable' });
    expect(decidePresenceGate({ ...base, presence: { enabled: false } })).toMatchObject({ required: true, reason: 'sensor_unavailable' });
  });
  it('still checking → held but not settled (no prompt yet)', () => {
    expect(decidePresenceGate({ ...base, status: 'loading', presence: null })).toEqual({ required: true, settled: false, reason: 'checking' });
  });
  it('an unexpired unlock passes; an expired one does not', () => {
    expect(decidePresenceGate({ ...base, presence: away, grantUntil: 2000 })).toMatchObject({ required: false, reason: 'unlocked' });
    expect(decidePresenceGate({ ...base, presence: away, grantUntil: 500 }).required).toBe(true);
  });
});
