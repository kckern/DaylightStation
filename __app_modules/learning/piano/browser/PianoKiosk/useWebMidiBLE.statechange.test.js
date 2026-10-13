import { describe, it, expect, vi } from 'vitest';
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

  it('re-arms the input after a reconnect statechange burst (re-establishes native delivery)', async () => {
    vi.useFakeTimers();
    try {
      const { access, input } = mockAccess();
      const { result } = renderHook(() => useWebMidiBLE({}));

      await act(async () => { await result.current.connect(); });
      expect(input.binds).toBe(1); // bound once on connect

      // A BLE reconnect: the SAME input object persists in access.inputs and
      // Chromium leaves onmidimessage pointing at our handler, yet native message
      // delivery was severed by the flap. A storm of statechange events fires.
      // The debounced rebind MUST force-re-arm the input (not skip it via the
      // same-object idempotency short-circuit) so notes flow again — otherwise the
      // input wedges "connected but silent" while the output keeps recovering.
      await act(async () => {
        access.onstatechange?.({ port: input });
        access.onstatechange?.({ port: input });
        access.onstatechange?.({ port: input });
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(250); });

      expect(input.binds).toBe(2); // re-armed exactly once after the burst settled
    } finally {
      vi.useRealTimers();
    }
  });

  it('binds a LATE-enumerating output after the debounced statechange burst settles', async () => {
    vi.useFakeTimers();
    try {
      const { access, input } = mockAccess();
      const { result } = renderHook(() => useWebMidiBLE({}));

      await act(async () => { await result.current.connect(); });
      expect(result.current.outputConnected).toBe(false); // no output present at connect time

      // The OUT port enumerates a beat later, and a BLE reconnect fires a STORM of
      // statechange events. The rebind is DEBOUNCED, so the output attaches once,
      // after the burst settles (~200ms) — not synchronously per event.
      access.outputs.set('o', { id: 'o', name: 'Piano', send() {} });
      await act(async () => {
        access.onstatechange?.({ port: input });
        access.onstatechange?.({ port: input });
        access.onstatechange?.({ port: input });
      });
      expect(result.current.outputConnected).toBe(false); // debounced — not yet bound

      await act(async () => { await vi.advanceTimersByTimeAsync(250); });
      expect(result.current.outputConnected).toBe(true);
      expect(result.current.outputName).toBe('Piano');
    } finally {
      vi.useRealTimers();
    }
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
