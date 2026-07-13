import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebMidiBLE } from './useWebMidiBLE.js';

// Web-MIDI mock with one input + one output. The input tracks whether
// onmidimessage was ever assigned, so a test can prove the input is NEVER
// armed when acquireInput:false (the bridge WS is the note-in path instead).
function mockAccess() {
  const input = {
    id: 'i',
    name: 'Piano',
    armed: false,
    closed: false,
    _h: null,
    get onmidimessage() { return this._h; },
    set onmidimessage(v) { if (v) this.armed = true; this._h = v; },
    open: async () => {},
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
  it('never arms the Web MIDI input, but does bind the output', async () => {
    const { input } = mockAccess();
    const { result } = renderHook(() => useWebMidiBLE({ acquireInput: false }));

    await act(async () => { await result.current.connect(); });

    expect(input.armed).toBe(false); // onmidimessage never set
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

  it('releases (closes + unhandlers) the Web MIDI input when acquireInput flips true→false (bridge appeared mid boot-race)', async () => {
    const { input } = mockAccess();
    const { result, rerender } = renderHook(
      ({ acquireInput }) => useWebMidiBLE({ acquireInput }),
      { initialProps: { acquireInput: true } },
    );

    // Boot-race: browser fell back and armed the Web MIDI input.
    await act(async () => { await result.current.connect(); });
    expect(input.armed).toBe(true);
    expect(input.onmidimessage).toBeTruthy();

    // The bridge's WS then connects → unavailable flips false → acquireInput false.
    // The browser MUST release the input so the native APK can hold the single BLE link.
    await act(async () => { rerender({ acquireInput: false }); });

    expect(input.onmidimessage).toBeNull(); // handler cleared
    expect(input.closed).toBe(true); // port closed → BLE freed for the APK
  });
});
