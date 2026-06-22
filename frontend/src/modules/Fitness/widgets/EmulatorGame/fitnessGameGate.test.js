import { describe, it, expect } from 'vitest';
import { isInRequiredZone, buildFitnessGameGate } from './fitnessGameGate.js';

const ZONES_ORDER = ['cool', 'warm', 'hot', 'max'];

describe('isInRequiredZone', () => {
  it('true when at or above the required zone', () => {
    expect(isInRequiredZone('warm', 'warm', ZONES_ORDER)).toBe(true);
    expect(isInRequiredZone('hot', 'warm', ZONES_ORDER)).toBe(true);
    expect(isInRequiredZone('cool', 'warm', ZONES_ORDER)).toBe(false);
    expect(isInRequiredZone(null, 'warm', ZONES_ORDER)).toBe(false);
  });
});

describe('buildFitnessGameGate credit mode', () => {
  const game = { governance: { mode: 'credit', required_zone: 'warm', earn_rate: 2, max_credit_seconds: 100 } };
  it('earns in-zone, depletes out, getStatus flips playing/depleted', () => {
    let zone = 'warm';
    const gate = buildFitnessGameGate({
      game, zonesOrder: ZONES_ORDER,
      getActivePlayerId: () => 'p', getUserVitals: () => ({ zoneId: zone }),
    });
    expect(gate.mode).toBe('credit');
    expect(gate.getStatus().state).toBe('depleted');     // starts at 0 credit
    gate.tick(3);                                         // in-zone: +6 earn, -3 spend = +3
    expect(gate.getStatus().state).toBe('playing');
    zone = 'cool';
    gate.tick(5);                                         // out: 0 earn, -5 spend → 0
    expect(gate.getStatus().state).toBe('depleted');
  });
});

describe('buildFitnessGameGate open mode', () => {
  it('open → always playing', () => {
    const gate = buildFitnessGameGate({ game: { governance: { mode: 'open' } }, zonesOrder: ZONES_ORDER, getActivePlayerId: () => null, getUserVitals: () => null });
    expect(gate.getStatus().state).toBe('playing');
    expect(gate.isPlayable()).toBe(true);
  });
});
