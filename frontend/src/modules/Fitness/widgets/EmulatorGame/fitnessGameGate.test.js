import { describe, it, expect, vi } from 'vitest';
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

  it('defaults to the open gate with no args (economy off)', () => {
    const gate = buildFitnessGameGate();
    expect(gate.mode).toBe('open');
    expect(gate.isPlayable()).toBe(true);
    expect(() => gate.tick(1)).not.toThrow();
  });
});

describe('buildFitnessGameGate (economy enabled)', () => {
  it('returns a coin-metered gate when economyEnabled + a userId resolves', async () => {
    const api = {
      openSession: vi.fn(async () => ({ sessionId: 'ses_test', balance: 5, drainPerSecond: 1 })),
      settle: vi.fn(async () => ({ balance: 0, depleted: false })),
      close: vi.fn(async () => ({ balance: 0 })),
    };
    const gate = buildFitnessGameGate({
      economyEnabled: true,
      getActivePlayerId: () => 'kid1',
      api,
    });
    expect(gate.mode).toBe('coin-metered');

    // Behavioral proof: starting invokes the injected economy api.
    await gate.start();
    expect(api.openSession).toHaveBeenCalledWith({ userId: 'kid1', action: 'arcade-play', source: 'emulator' });
    expect(gate.isPlayable()).toBe(true);
    await gate.stop();
  });

  it('falls back to the open gate when getActivePlayerId resolves null', () => {
    const gate = buildFitnessGameGate({
      economyEnabled: true,
      getActivePlayerId: () => null,
    });
    expect(gate.mode).toBe('open');
    expect(gate.isPlayable()).toBe(true);
    expect(() => gate.tick(1)).not.toThrow();
  });
});
