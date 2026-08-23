import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Pin the bridge-first OUT routing added 2026-08-23. Two defect classes drove it:
//  1. The Web MIDI output handle goes zombie (send() "succeeds", nothing leaves
//     the tablet) — so when the bridge is up, EVERY immediate and scheduled send
//     must take the bridge's loopback-verified path, not the handle.
//  2. The first bridge-first pass carved out the timestamped senders, and score
//     playback fell straight through the hole — noteheads lit, piano silent,
//     nothing logged. These tests make that carve-out impossible to reintroduce
//     silently: scheduled senders must route via bridgeSendMidiAt, and a send
//     with NO path must return false (the audio-plane-dead witness path).
vi.mock('./bridgeMidiOut.js', () => ({
  bridgeSendMidi: vi.fn(() => false),
  bridgeSendMidiAt: vi.fn(() => false),
  bridgeOutUp: vi.fn(() => false),
}));

import { bridgeSendMidi, bridgeSendMidiAt, bridgeOutUp } from './bridgeMidiOut.js';
import { useWebMidiBLE } from './useWebMidiBLE.js';

function mockMidi() {
  const sent = [];
  const output = { send: (...args) => sent.push(args) };
  global.navigator.requestMIDIAccess = async () => ({
    inputs: new Map([['i', { id: 'i', name: 'Piano', onmidimessage: null }]]),
    outputs: new Map([['o', output]]),
    onstatechange: null,
  });
  return sent;
}

beforeEach(() => {
  vi.clearAllMocks();
  // mockReturnValue persists through clearAllMocks — pin the "bridge down"
  // default explicitly so each test opts IN to the bridge being up.
  bridgeSendMidi.mockReturnValue(false);
  bridgeSendMidiAt.mockReturnValue(false);
  bridgeOutUp.mockReturnValue(false);
});

describe('useWebMidiBLE bridge-first routing', () => {
  it('immediate control sends go to the bridge when it is up — the Web MIDI handle is not touched', async () => {
    bridgeSendMidi.mockReturnValue(true);
    bridgeOutUp.mockReturnValue(true);
    const sent = mockMidi();
    const { result } = renderHook(() => useWebMidiBLE({}));
    await act(async () => { await result.current.connect(); });
    act(() => {
      result.current.sendVoice(24, 0, 0);
      result.current.sendControlChange(91, 64, 0);
      result.current.sendNote(60, 100, 0);
    });
    expect(bridgeSendMidi).toHaveBeenCalledWith([0xc0, 24]);
    expect(bridgeSendMidi).toHaveBeenCalledWith([0xb0, 91, 64]);
    expect(bridgeSendMidi).toHaveBeenCalledWith([0x90, 60, 100]);
    expect(sent).toEqual([]); // nothing through the zombie-prone handle
  });

  it('control sends work with NO Web MIDI output at all while the bridge is up', () => {
    bridgeSendMidi.mockReturnValue(true);
    bridgeOutUp.mockReturnValue(true);
    const { result } = renderHook(() => useWebMidiBLE({}));
    // no connect(): outputRef is null — the 2026-08-22 dead-handle scenario
    expect(result.current.sendVoice(5, 0, 0)).toBe(true);
    expect(result.current.sendControlChange(91, 10, 0)).toBe(true);
    expect(result.current.sendPanic(0)).toBe(true);
  });

  it('SCHEDULED sends route via bridgeSendMidiAt — the hole score playback fell through', () => {
    bridgeSendMidiAt.mockReturnValue(true);
    bridgeOutUp.mockReturnValue(true);
    const { result } = renderHook(() => useWebMidiBLE({}));
    const now = performance.now();
    expect(result.current.sendNoteAt(64, 90, now + 400, 0)).toBe(true);
    expect(result.current.sendNoteOffAt(64, now + 700, 0)).toBe(true);
    expect(bridgeSendMidiAt).toHaveBeenCalledTimes(2);
    const [bytesOn, inMsOn] = bridgeSendMidiAt.mock.calls[0];
    expect(bytesOn).toEqual([0x90, 64, 90]);
    expect(inMsOn).toBeGreaterThan(300);
    expect(inMsOn).toBeLessThan(500);
  });

  it('scheduleNotes routes every event via the bridge when up', () => {
    bridgeSendMidiAt.mockReturnValue(true);
    bridgeOutUp.mockReturnValue(true);
    const { result } = renderHook(() => useWebMidiBLE({}));
    const ok = result.current.scheduleNotes([
      { t: 0, type: 'note_on', note: 60, velocity: 80 },
      { t: 250, type: 'note_off', note: 60 },
    ]);
    expect(ok).toBe(true);
    expect(bridgeSendMidiAt).toHaveBeenCalledWith([0x90, 60, 80], 0);
    expect(bridgeSendMidiAt).toHaveBeenCalledWith([0x80, 60, 0], 250);
  });

  it('falls back to Web MIDI timestamped send when the bridge is down', async () => {
    const sent = mockMidi();
    const { result } = renderHook(() => useWebMidiBLE({}));
    await act(async () => { await result.current.connect(); });
    act(() => { result.current.sendNoteAt(60, 80, 1234.5, 0); });
    expect(sent).toContainEqual([[0x90, 60, 80], 1234.5]);
  });

  it('returns false (the audio-plane-dead witness path) when there is NO path at all', () => {
    const { result } = renderHook(() => useWebMidiBLE({}));
    expect(result.current.sendNoteAt(60, 80, 100, 0)).toBe(false);
    expect(result.current.scheduleNotes([{ t: 0, type: 'note_on', note: 60, velocity: 80 }])).toBe(false);
  });
});
