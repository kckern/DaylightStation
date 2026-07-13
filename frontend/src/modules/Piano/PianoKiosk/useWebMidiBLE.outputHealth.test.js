import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebMidiBLE, isPortConnected } from './useWebMidiBLE.js';

// Output mock carrying a real `state`, so tests can prove OUT health tracks the
// port's BLE state (not mere object presence) — the silent-dead-output guard.
function mockAccess({ outState = 'connected', outputs } = {}) {
  const output = { id: 'o', name: 'jam-7e6', state: outState, send: () => {} };
  const access = {
    inputs: new Map(),
    outputs: new Map((outputs || [['o', output]])),
    onstatechange: null,
  };
  global.navigator.requestMIDIAccess = async () => access;
  return { access, output };
}

describe('isPortConnected', () => {
  it('true for a connected port, false for a disconnected one', () => {
    expect(isPortConnected({ state: 'connected' })).toBe(true);
    expect(isPortConnected({ state: 'disconnected' })).toBe(false);
  });
  it('treats a missing state as connected (old stacks / mocks)', () => {
    expect(isPortConnected({})).toBe(true);
    expect(isPortConnected(null)).toBe(false);
  });
});

describe('useWebMidiBLE output health (real port.state)', () => {
  it('outputConnected is TRUE when the bound output is connected', async () => {
    mockAccess({ outState: 'connected' });
    const { result } = renderHook(() => useWebMidiBLE({ acquireInput: false }));
    await act(async () => { await result.current.connect(); });
    expect(result.current.outputConnected).toBe(true);
  });

  it('outputConnected is FALSE for a present-but-disconnected output (silent-dead guard)', async () => {
    mockAccess({ outState: 'disconnected' });
    const { result } = renderHook(() => useWebMidiBLE({ acquireInput: false }));
    await act(async () => { await result.current.connect(); });
    // Port exists (outputName set) but is dead → health must read false, not true.
    expect(result.current.outputName).toBe('jam-7e6');
    expect(result.current.outputConnected).toBe(false);
  });

  it('prefers a CONNECTED output over a stale disconnected one', async () => {
    const dead = { id: 'dead', name: 'stale', state: 'disconnected', send: () => {} };
    const live = { id: 'live', name: 'jam-7e6', state: 'connected', send: () => {} };
    mockAccess({ outputs: [['dead', dead], ['live', live]] });
    const { result } = renderHook(() => useWebMidiBLE({ acquireInput: false }));
    await act(async () => { await result.current.connect(); });
    expect(result.current.outputName).toBe('jam-7e6'); // picked the live one, not stale[0]
    expect(result.current.outputConnected).toBe(true);
  });
});
