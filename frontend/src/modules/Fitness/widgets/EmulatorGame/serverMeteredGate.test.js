import { describe, it, expect } from 'vitest';
import { createServerMeteredGate } from './serverMeteredGate.js';

describe('createServerMeteredGate — the server owns the balance', () => {
  it('is playable before the first update, so a launch never races the network', () => {
    const gate = createServerMeteredGate();
    expect(gate.isPlayable()).toBe(true);
  });

  it('treats an ungranted budget as nothing to gate on', () => {
    const gate = createServerMeteredGate();
    gate.update({ mode: 'elapsed', ms: 120_000 });
    expect(gate.getStatus()).toMatchObject({ state: 'ok', unlimited: true });
    expect(gate.isPlayable()).toBe(true);
  });

  it('warns as the server-reported time runs low', () => {
    const gate = createServerMeteredGate();
    gate.update({ mode: 'remaining', ms: 30_000 });
    expect(gate.getStatus().state).toBe('warning');
    expect(gate.isPlayable()).toBe(true);
  });

  it('stops being playable when the server says the time is gone', () => {
    const gate = createServerMeteredGate();
    gate.update({ mode: 'remaining', ms: 0 });
    expect(gate.getStatus().state).toBe('depleted');
    expect(gate.isPlayable()).toBe(false);
  });

  it('is a local SAFETY stop — depletion holds even if updates stop arriving', () => {
    const gate = createServerMeteredGate();
    gate.update({ mode: 'remaining', ms: 0 });
    gate.update({ mode: 'remaining', ms: 0, stale: true });
    expect(gate.isPlayable()).toBe(false);
  });

  it('never settles or charges anything', () => {
    const gate = createServerMeteredGate();
    // The whole surface: no settle, no close, no coins.
    expect(Object.keys(gate).sort()).toEqual(['dispose', 'getStatus', 'isPlayable', 'onChange', 'update']);
  });
});

describe('createServerMeteredGate — notification', () => {
  it('notifies on a real change only', () => {
    const seen = [];
    const gate = createServerMeteredGate();
    gate.onChange((s) => seen.push(s.state));
    gate.update({ mode: 'remaining', ms: 300_000 });
    gate.update({ mode: 'remaining', ms: 300_000 });
    gate.update({ mode: 'remaining', ms: 30_000 });
    expect(seen).toEqual(['ok', 'warning']);
  });

  it('unsubscribes cleanly', () => {
    const seen = [];
    const gate = createServerMeteredGate();
    const off = gate.onChange((s) => seen.push(s.state));
    off();
    gate.update({ mode: 'remaining', ms: 0 });
    expect(seen).toEqual([]);
  });

  it('a throwing listener does not break the gate', () => {
    const gate = createServerMeteredGate();
    gate.onChange(() => { throw new Error('bad listener'); });
    expect(() => gate.update({ mode: 'remaining', ms: 0 })).not.toThrow();
    expect(gate.isPlayable()).toBe(false);
  });

  it('subscribes to a budget feed when given one', () => {
    let push;
    const gate = createServerMeteredGate({ subscribeBudget: (fn) => { push = fn; return () => {}; } });
    push({ mode: 'remaining', ms: 0 });
    expect(gate.isPlayable()).toBe(false);
  });
});
