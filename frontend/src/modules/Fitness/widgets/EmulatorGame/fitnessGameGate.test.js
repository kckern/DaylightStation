import { describe, it, expect } from 'vitest';
import { buildFitnessGameGate } from './fitnessGameGate.js';

const ZONES_ORDER = ['cool', 'warm', 'hot', 'max'];

describe('buildFitnessGameGate (governance disabled)', () => {
  it('always playable regardless of game governance config', () => {
    const gate = buildFitnessGameGate({
      game: { governance: { mode: 'credit', required_zone: 'warm', earn_rate: 2, max_credit_seconds: 100 } },
      zonesOrder: ZONES_ORDER,
      getActivePlayerId: () => 'p',
      getUserVitals: () => ({ zoneId: 'cool' }),
    });
    expect(gate.getStatus().state).toBe('playing');
    expect(gate.isPlayable()).toBe(true);
  });

  it('exposes a no-op tick (host interval caller stays harmless)', () => {
    const gate = buildFitnessGameGate({ game: { governance: { mode: 'open' } } });
    expect(() => gate.tick(5)).not.toThrow();
    expect(gate.getStatus().state).toBe('playing');
  });
});
