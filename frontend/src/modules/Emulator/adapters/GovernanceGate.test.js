import { describe, it, expect } from 'vitest';
import { createOpenGate, createGateAdapter, createCreditAccumulator } from './GovernanceGate.js';

describe('createOpenGate', () => {
  it('is always playable', () => {
    const gate = createOpenGate();
    expect(gate.mode).toBe('open');
    expect(gate.isPlayable()).toBe(true);
  });

  it('reports playing status', () => {
    const gate = createOpenGate();
    expect(gate.getStatus().state).toBe('playing');
  });

  it('onChange returns a no-op unsubscribe', () => {
    const gate = createOpenGate();
    const unsub = gate.onChange(() => {});
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });
});

describe('createGateAdapter', () => {
  it('has gate mode', () => {
    const a = createGateAdapter({ getPhase: () => 'unlocked' });
    expect(a.mode).toBe('gate');
  });

  it('isPlayable only when unlocked', () => {
    let phase = 'unlocked';
    const a = createGateAdapter({ getPhase: () => phase });
    expect(a.isPlayable()).toBe(true);
    phase = 'warning';
    expect(a.isPlayable()).toBe(false);
    phase = 'pending';
    expect(a.isPlayable()).toBe(false);
    phase = 'locked';
    expect(a.isPlayable()).toBe(false);
  });

  it('maps each phase to a status state', () => {
    let phase = 'unlocked';
    const a = createGateAdapter({ getPhase: () => phase });
    expect(a.getStatus().state).toBe('playing');
    phase = 'warning';
    expect(a.getStatus().state).toBe('warning');
    phase = 'pending';
    expect(a.getStatus().state).toBe('paused');
    phase = 'locked';
    expect(a.getStatus().state).toBe('paused');
    phase = undefined;
    expect(a.getStatus().state).toBe('paused');
  });

  it('onChange returns a no-op unsubscribe', () => {
    const a = createGateAdapter({ getPhase: () => 'unlocked' });
    const unsub = a.onChange(() => {});
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });
});

describe('createCreditAccumulator', () => {
  it('earns net credit while in-zone (earnRate > 1)', () => {
    const acc = createCreditAccumulator({ earnRate: 2, maxCredit: 100 });
    acc.tick(1, true); // earn 2, spend 1 => net 1
    expect(acc.creditSeconds).toBeCloseTo(1, 6);
    expect(acc.isPlayable()).toBe(true);
  });

  it('depletes toward 0 when out-of-zone and never goes below 0', () => {
    const acc = createCreditAccumulator({ earnRate: 2, maxCredit: 100 });
    // seed some credit
    acc.tick(1, true);
    acc.tick(1, true); // ~2s of credit
    expect(acc.creditSeconds).toBeCloseTo(2, 6);
    acc.tick(1, false); // spend 1 => 1
    acc.tick(1, false); // spend 1 => 0
    expect(acc.creditSeconds).toBe(0);
    expect(acc.isPlayable()).toBe(false);
    acc.tick(1, false); // stays at 0
    expect(acc.creditSeconds).toBe(0);
  });

  it('clamps earned credit to maxCredit', () => {
    const acc = createCreditAccumulator({ earnRate: 1000, maxCredit: 5 });
    acc.tick(1, true); // earn 1000 -> clamp 5, spend 1 -> 4
    expect(acc.creditSeconds).toBeCloseTo(4, 6);
    expect(acc.creditSeconds).toBeLessThanOrEqual(5);
  });
});
