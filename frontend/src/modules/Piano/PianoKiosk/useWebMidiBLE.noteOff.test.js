import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebMidiBLE } from './useWebMidiBLE.js';

// Minimal Web-MIDI mock: one output capturing send() calls (same pattern as
// useWebMidiBLE.localControl.test.js).
function mockMidi() {
  const sent = [];
  const output = { send: (msg) => sent.push(msg) };
  global.navigator.requestMIDIAccess = async () => ({
    inputs: new Map([['i', { id: 'i', name: 'Piano', onmidimessage: null }]]),
    outputs: new Map([['o', output]]),
    onstatechange: null,
  });
  return sent;
}

describe('useWebMidiBLE sendNoteOff', () => {
  it('sends a channel-aware note-off (0x80|ch) — the Producer tier holds notes indefinitely', async () => {
    const sent = mockMidi();
    const { result } = renderHook(() => useWebMidiBLE({}));
    await act(async () => {
      await result.current.connect();
    });
    act(() => {
      result.current.sendNote(60, 100, 3); // note-on only (no duration)
      result.current.sendNoteOff(60, 3);
      result.current.sendNoteOff(64); // default channel 0
    });
    expect(sent).toContainEqual([0x90 | 3, 60, 100]);
    expect(sent).toContainEqual([0x80 | 3, 60, 0]);
    expect(sent).toContainEqual([0x80, 64, 0]);
  });

  it('returns false when no output is bound', () => {
    const { result } = renderHook(() => useWebMidiBLE({}));
    expect(result.current.sendNoteOff(60, 0)).toBe(false);
  });
});
