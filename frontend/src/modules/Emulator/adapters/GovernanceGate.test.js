import { describe, it, expect } from 'vitest';
import { createOpenGate } from './GovernanceGate.js';

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
