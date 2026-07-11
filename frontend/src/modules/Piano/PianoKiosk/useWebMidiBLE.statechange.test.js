import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebMidiBLE } from './useWebMidiBLE.js';

// Web-MIDI mock whose single input counts how many times a handler is bound to it
// (onmidimessage assigned to a non-null value) and exposes the access object so a
// test can fire onstatechange the way a flapping BLE link does.
function mockAccess() {
  const input = {
    id: 'i',
    name: 'Piano',
    binds: 0,
    _h: null,
    get onmidimessage() { return this._h; },
    set onmidimessage(v) { if (v) this.binds += 1; this._h = v; },
  };
  const access = {
    inputs: new Map([['i', input]]),
    outputs: new Map(),
    onstatechange: null,
  };
  global.navigator.requestMIDIAccess = async () => access;
  return { access, input };
}

describe('useWebMidiBLE onstatechange', () => {
  it('does not re-bind the input when statechange fires for the already-connected input', async () => {
    const { access, input } = mockAccess();
    const { result } = renderHook(() => useWebMidiBLE({}));

    await act(async () => { await result.current.connect(); });
    expect(input.binds).toBe(1); // bound once on connect

    // A chattery BLE link fires repeated statechange events for the same, still-
    // present port. These must not re-bind (which storms re-renders on the tablet).
    await act(async () => {
      access.onstatechange?.({ port: input });
      access.onstatechange?.({ port: input });
      access.onstatechange?.({ port: input });
    });

    expect(input.binds).toBe(1); // still bound exactly once — no churn
  });

  it('binds a LATE-enumerating output on a later statechange (BLE output races the input)', async () => {
    const { access, input } = mockAccess();
    const { result } = renderHook(() => useWebMidiBLE({}));

    await act(async () => { await result.current.connect(); });
    expect(result.current.outputConnected).toBe(false); // no output present at connect time

    // The OUT port enumerates a beat later; a statechange fires for the still-present
    // input (the input is idempotent, but the output must still attach — the bug).
    access.outputs.set('o', { id: 'o', name: 'Piano', send() {} });
    await act(async () => { access.onstatechange?.({ port: input }); });

    expect(result.current.outputConnected).toBe(true);
    expect(result.current.outputName).toBe('Piano');
  });

  it('resetLink re-scans and re-binds the input + output', async () => {
    const { access } = mockAccess();
    access.outputs.set('o', { id: 'o', name: 'Piano', send() {} });
    const { result } = renderHook(() => useWebMidiBLE({}));

    await act(async () => { await result.current.connect(); });
    expect(result.current.outputConnected).toBe(true);

    await act(async () => { await result.current.resetLink(); });
    expect(result.current.connected).toBe(true);
    expect(result.current.outputConnected).toBe(true);
  });
});
