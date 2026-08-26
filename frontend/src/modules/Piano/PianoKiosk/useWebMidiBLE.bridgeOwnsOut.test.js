import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('./bridgeMidiOut.js', () => ({
  bridgeSendMidi: vi.fn(() => true),
  bridgeSendMidiAt: vi.fn(() => true),
  bridgeOutUp: vi.fn(() => false),
}));

import { bridgeSendMidi, bridgeOutUp } from './bridgeMidiOut.js';
import { useWebMidiBLE } from './useWebMidiBLE.js';

// Why this file exists — the 2026-08-26 one-way outage.
//
// Android exposes ONE BluetoothGatt for the JamCorder, shared by the piano-bridge
// APK and Chromium's Web MIDI, and it permits one outstanding GATT operation at a
// time. When the kiosk page re-acquired Web MIDI while the BLE link was rebuilding,
// its operation stalled and blocked the queue behind it: every ATT Write Command
// (all MIDI OUT) was silently dropped, while notifications (MIDI IN) kept flowing
// because inbound data does not use that queue. Hence one-way, for 19 hours, through
// 104 reconnect attempts, a radio bounce, and reboots of BOTH endpoints.
//
// Measured cure: with Chromium parked on about:blank — holding no Web MIDI at all —
// the SAME radio bounce that had failed all day recovered the link immediately
// (JamCorder ble.in +12, loopback echo at 30ms).
//
// Since 2026-08-23 the kiosk needs Web MIDI for NOTHING: notes arrive over the
// bridge WebSocket and sends go out through the bridge. So when the bridge owns OUT,
// the browser must not touch Web MIDI — that removes the second GATT client, which
// is the root cause rather than another recovery rung.

function mockAccess() {
  const input = {
    id: 'i',
    name: 'jam-7e6',
    armed: false,
    opened: false,
    closed: false,
    _h: null,
    get onmidimessage() { return this._h; },
    set onmidimessage(v) { if (v) this.armed = true; this._h = v; },
    open: async () => { input.opened = true; },
    close: async () => { input.closed = true; },
  };
  const output = {
    id: 'o',
    name: 'jam-7e6',
    state: 'connected',
    connection: 'open',
    closed: false,
    send: () => {},
    close: async () => { output.closed = true; },
  };
  const access = {
    inputs: new Map([['i', input]]),
    outputs: new Map([['o', output]]),
    onstatechange: null,
  };
  const requestMIDIAccess = vi.fn(async () => access);
  global.navigator.requestMIDIAccess = requestMIDIAccess;
  return { access, input, output, requestMIDIAccess };
}

beforeEach(() => {
  vi.clearAllMocks();
  bridgeOutUp.mockReturnValue(false);
  bridgeSendMidi.mockReturnValue(true);
});

describe('bridge owns OUT → the browser never touches Web MIDI', () => {
  it('does not request MIDI access at all when the bridge is up', async () => {
    const { requestMIDIAccess } = mockAccess();
    bridgeOutUp.mockReturnValue(true);

    const { result } = renderHook(() => useWebMidiBLE({ acquireInput: false }));
    await act(async () => { await result.current.connect(); });

    // The whole point: no second GATT client is ever created.
    expect(requestMIDIAccess).not.toHaveBeenCalled();
    expect(result.current.status).toBe('connected');
  });

  it('reports OUT as up so downstream re-assert still fires', async () => {
    mockAccess();
    bridgeOutUp.mockReturnValue(true);

    const { result } = renderHook(() => useWebMidiBLE({ acquireInput: false }));
    await act(async () => { await result.current.connect(); });

    expect(result.current.outputConnected).toBe(true);
  });

  it('still sends — through the bridge, with no Web MIDI port bound', async () => {
    mockAccess();
    bridgeOutUp.mockReturnValue(true);

    const { result } = renderHook(() => useWebMidiBLE({ acquireInput: false }));
    await act(async () => { await result.current.connect(); });

    let sent;
    act(() => { sent = result.current.sendVoice(42); });

    expect(sent).toBe(true);
    expect(bridgeSendMidi).toHaveBeenCalled();
  });

  it('RELEASES Web MIDI it grabbed during the boot race once the bridge appears', async () => {
    // The hazard: bridgeOutUp() is false for the first probe interval, so a kiosk
    // page can acquire Web MIDI before the bridge is known to be up. Holding those
    // ports is what poisons the shared GATT queue, so they must be given back.
    const { input, output } = mockAccess();
    bridgeOutUp.mockReturnValue(false);

    const { result, rerender } = renderHook(() => useWebMidiBLE({ acquireInput: false }));
    await act(async () => { await result.current.connect(); });
    expect(input.opened).toBe(true); // grabbed during the race

    bridgeOutUp.mockReturnValue(true);
    await act(async () => { rerender(); });

    // Released by the 2s watchdog tick — bridgeOutUp() flipping is not a React
    // signal, so the poll is deliberately the catch for the boot race.
    await waitFor(() => {
      expect(input.closed).toBe(true);
      expect(output.closed).toBe(true);
    }, { timeout: 6000 });
  });
});

describe('no bridge (laptop with a MIDI keyboard) → unchanged behaviour', () => {
  it('acquires Web MIDI and arms the input when the bridge is absent', async () => {
    const { input, requestMIDIAccess } = mockAccess();
    bridgeOutUp.mockReturnValue(false);

    const { result } = renderHook(() => useWebMidiBLE({ acquireInput: true }));
    await act(async () => { await result.current.connect(); });

    expect(requestMIDIAccess).toHaveBeenCalled();
    expect(input.armed).toBe(true);
    expect(result.current.status).toBe('connected');
  });

  it('holds the input open for OUTPUT when acquireInput is false but no bridge is up', async () => {
    const { input, requestMIDIAccess } = mockAccess();
    bridgeOutUp.mockReturnValue(false);

    const { result } = renderHook(() => useWebMidiBLE({ acquireInput: false }));
    await act(async () => { await result.current.connect(); });

    expect(requestMIDIAccess).toHaveBeenCalled();
    expect(input.opened).toBe(true);
    expect(input.armed).toBe(false);
  });
});
