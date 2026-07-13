import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebMidiBLE } from './useWebMidiBLE.js';

// Web-MIDI mock with one input + one output. The input tracks whether
// onmidimessage was ever assigned (armed = we LISTEN for notes) and whether the
// port was opened (held = attached to the BLE device for OUTPUT delivery). In
// bridge mode we HOLD the input open (opened=true) without arming it
// (armed=false) — the bridge WS supplies notes but the open port is what makes
// MIDI OUTPUT traverse the BLE link.
function mockAccess() {
  const input = {
    id: 'i',
    name: 'Piano',
    armed: false,
    opened: false,
    closed: false,
    _h: null,
    get onmidimessage() { return this._h; },
    set onmidimessage(v) { if (v) this.armed = true; this._h = v; },
    open: async () => { input.opened = true; },
    close: async () => { input.closed = true; },
  };
  const output = { id: 'o', name: 'Piano', send: () => {} };
  const access = {
    inputs: new Map([['i', input]]),
    outputs: new Map([['o', output]]),
    onstatechange: null,
  };
  global.navigator.requestMIDIAccess = async () => access;
  return { access, input, output };
}

describe('useWebMidiBLE acquireInput:false (bridge mode)', () => {
  it('binds OUTPUT only and never opens the input (no second BLE claimant on the APK device)', async () => {
    const { input } = mockAccess();
    const { result } = renderHook(() => useWebMidiBLE({ acquireInput: false }));

    await act(async () => { await result.current.connect(); });

    expect(input.armed).toBe(false); // we do NOT listen — bridge WS supplies notes
    expect(input.opened).toBe(false); // and we do NOT open it — that flapped the APK's link
    expect(result.current.outputConnected).toBe(true);
    expect(result.current.status).toBe('connected');
    expect(result.current.connected).toBe(true);
  });

  it('feedNote drives the note store without touching Web MIDI input', async () => {
    mockAccess();
    const { result } = renderHook(() => useWebMidiBLE({ acquireInput: false }));
    await act(async () => { await result.current.connect(); });

    act(() => { result.current.feedNote('note_on', 60, 90); });
    expect(result.current.notes.getSnapshot().activeNotes.has(60)).toBe(true);

    act(() => { result.current.feedNote('note_off', 60); });
    expect(result.current.notes.getSnapshot().activeNotes.has(60)).toBe(false);
  });

  it('default acquireInput (true) still arms the input as before', async () => {
    const { input } = mockAccess();
    const { result } = renderHook(() => useWebMidiBLE({}));
    await act(async () => { await result.current.connect(); });
    expect(input.armed).toBe(true);
    expect(result.current.status).toBe('connected');
  });

  it('arms the input when acquireInput flips false→true after connect (bridge deemed absent)', async () => {
    const { input } = mockAccess();
    const { result, rerender } = renderHook(
      ({ acquireInput }) => useWebMidiBLE({ acquireInput }),
      { initialProps: { acquireInput: false } },
    );

    await act(async () => { await result.current.connect(); });
    expect(input.armed).toBe(false); // output-only while bridge-first

    // Non-kiosk client: bridge never appears → acquireInput flips true ~1s later.
    await act(async () => { rerender({ acquireInput: true }); });

    expect(input.armed).toBe(true); // Web MIDI input now armed (fallback)
    expect(result.current.status).toBe('connected');
  });

  it('RELEASES the Web MIDI input when acquireInput flips true→false (bridge appeared)', async () => {
    const { input } = mockAccess();
    const { result, rerender } = renderHook(
      ({ acquireInput }) => useWebMidiBLE({ acquireInput }),
      { initialProps: { acquireInput: true } },
    );

    // Non-kiosk fallback: browser armed the Web MIDI input for notes.
    await act(async () => { await result.current.connect(); });
    expect(input.armed).toBe(true);
    expect(input.onmidimessage).toBeTruthy();

    // The bridge then appears → acquireInput flips false. We stop listening AND
    // close the port, so the browser is no longer a second claimant on the APK's
    // BLE device (holding it open flapped the link). Notes come from the bridge WS.
    await act(async () => { rerender({ acquireInput: false }); });

    expect(input.onmidimessage).toBeNull(); // no longer listening
    expect(input.closed).toBe(true); // released → not contending on jam-7e6
  });
});
