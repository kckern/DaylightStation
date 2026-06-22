import { describe, it, expect } from 'vitest';
import { createOpenGate, createGateAdapter } from './GovernanceGate.js';

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
