import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebMidiBLE } from './useWebMidiBLE.js';

// Web-MIDI mock in the same shape as useWebMidiBLE.noteOff.test.js (one input +
// one output port), but with a vi.fn() send so we can assert the timestamp arg.
// `outputs: []` yields an access object with no output port.
function mockMidi({ outputs } = {}) {
  const output = { send: vi.fn() };
  const outMap = outputs === undefined ? new Map([['o', output]]) : new Map();
  global.navigator.requestMIDIAccess = async () => ({
    inputs: new Map([['i', { id: 'i', name: 'Piano', onmidimessage: null }]]),
    outputs: outMap,
    onstatechange: null,
  });
  return output;
}

async function connectHook(opts) {
  const output = mockMidi(opts);
  const { result } = renderHook(() => useWebMidiBLE({}));
  await act(async () => {
    await result.current.connect();
  });
  return { result, output };
}

describe('sendNoteAt / sendNoteOffAt', () => {
  it('sends note-on with the exact wall timestamp and no state side effects', async () => {
    const { result, output } = await connectHook();
    act(() => {
      result.current.sendNoteAt(60, 90, 12345.5);
    });
    expect(output.send).toHaveBeenCalledWith([0x90, 60, 90], 12345.5);
    // The scheduled note must NOT light the on-screen keyboard.
    expect(result.current.activeNotes.has(60)).toBe(false);
  });

  it('sends note-off with the exact wall timestamp', async () => {
    const { result, output } = await connectHook();
    act(() => {
      result.current.sendNoteOffAt(60, 23456.25);
    });
    expect(output.send).toHaveBeenCalledWith([0x80, 60, 0], 23456.25);
  });

  it('returns false when no output port exists', async () => {
    const { result } = await connectHook({ outputs: [] });
    let onRet, offRet;
    act(() => {
      onRet = result.current.sendNoteAt(60, 90, 100);
      offRet = result.current.sendNoteOffAt(60, 100);
    });
    expect(onRet).toBe(false);
    expect(offRet).toBe(false);
  });
});
