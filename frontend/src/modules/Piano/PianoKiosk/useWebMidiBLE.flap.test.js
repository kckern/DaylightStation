import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Silence the async log transport — the watchdog logs on every timer advance, and
// a pending log RPC at worker teardown surfaces as a false unhandled error under
// the parallel suite (matches sibling PianoKiosk tests).
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
}));

import { useWebMidiBLE } from './useWebMidiBLE.js';

// Web-MIDI mock whose ports carry a `state` ('connected' | 'disconnected') the way
// a real BLE-MIDI port does across a flap — the signal the hook must trust instead
// of object truthiness / handler-property identity.
function makePort(id, name, state = 'connected') {
  return {
    id, name, state, binds: 0, _h: null,
    get onmidimessage() { return this._h; },
    set onmidimessage(v) { if (v) this.binds += 1; this._h = v; },
    open() { return Promise.resolve(); },
    send() {},
  };
}
function mockAccess({ inputs = [], outputs = [] } = {}) {
  const access = {
    inputs: new Map(inputs.map((p) => [p.id, p])),
    outputs: new Map(outputs.map((p) => [p.id, p])),
    onstatechange: null,
  };
  global.navigator.requestMIDIAccess = async () => access;
  return access;
}

describe('useWebMidiBLE — BLE flap health (state-based)', () => {
  it('"neither": binds a present output even with no input yet, and recovers when the input appears (watchdog not gated on status)', async () => {
    vi.useFakeTimers();
    try {
      const out = makePort('o', 'Piano');
      const access = mockAccess({ inputs: [], outputs: [out] }); // output present, input late
      const { result } = renderHook(() => useWebMidiBLE({}));

      await act(async () => { await result.current.connect(); });
      // output must bind independently of input presence
      expect(result.current.outputConnected).toBe(true);

      // input enumerates late WITHOUT a fresh statechange; the (ungated) watchdog must attach it
      access.inputs.set('i', makePort('i', 'Piano'));
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
      expect(result.current.connected).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('"only IN": a disconnected-but-present output is reported not-connected and re-attaches on reconnect', async () => {
    vi.useFakeTimers();
    try {
      const inp = makePort('i', 'Piano');
      const out = makePort('o', 'Piano');
      const access = mockAccess({ inputs: [inp], outputs: [out] });
      const { result } = renderHook(() => useWebMidiBLE({}));

      await act(async () => { await result.current.connect(); });
      expect(result.current.outputConnected).toBe(true);

      out.state = 'disconnected'; // BLE flap: object stays in the map (truthy) but dead
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
      expect(result.current.outputConnected).toBe(false); // truthiness must not read as healthy

      out.state = 'connected';
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
      expect(result.current.outputConnected).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('"only OUT": the watchdog re-arms an input that flapped disconnected (even with the handler property intact)', async () => {
    vi.useFakeTimers();
    try {
      const inp = makePort('i', 'Piano');
      const out = makePort('o', 'Piano');
      const access = mockAccess({ inputs: [inp], outputs: [out] });
      const { result } = renderHook(() => useWebMidiBLE({}));

      await act(async () => { await result.current.connect(); });
      expect(inp.binds).toBe(1);
      expect(inp.onmidimessage).not.toBeNull(); // handler property survives the flap

      inp.state = 'disconnected'; // delivery severed; onmidimessage stays set
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
      inp.state = 'connected';
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });

      expect(inp.binds).toBeGreaterThan(1); // re-armed despite the property looking bound
    } finally { vi.useRealTimers(); }
  });

  it('prefers a CONNECTED input over a stale disconnected one left in the map', async () => {
    const stale = makePort('i', 'Piano', 'disconnected'); // same id as the saved one, now dead
    const live = makePort('i2', 'Piano', 'connected');
    const access = mockAccess({ inputs: [stale, live], outputs: [] });
    const { result } = renderHook(() => useWebMidiBLE({}));

    await act(async () => { await result.current.connect(); });

    expect(result.current.connected).toBe(true);
    expect(stale.binds).toBe(0);   // never bound the dead port
    expect(live.binds).toBe(1);    // bound the live one
  });
});
