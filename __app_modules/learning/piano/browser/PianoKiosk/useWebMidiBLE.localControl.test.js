import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebMidiBLE } from './useWebMidiBLE.js';

// Minimal Web-MIDI mock: one output capturing send() calls.
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

describe('useWebMidiBLE sendLocalControl', () => {
  it('sends CC122 0 to disable local control, 127 to enable', async () => {
    const sent = mockMidi();
    const { result } = renderHook(() => useWebMidiBLE({}));
    await act(async () => {
      await result.current.connect();
    });
    act(() => {
      result.current.sendLocalControl(false);
      result.current.sendLocalControl(true);
    });
    expect(sent).toContainEqual([0xb0, 122, 0]);
    expect(sent).toContainEqual([0xb0, 122, 127]);
  });
});
