import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const midiState = { activeNotes: new Map() };
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => midiState,
  usePianoMidiNotes: () => midiState,
}));

import { useEngagementGate } from './useEngagementGate.js';

beforeEach(() => {
  vi.useFakeTimers();
  midiState.activeNotes = new Map();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useEngagementGate', () => {
  it('does not open the gate when isSequential is false', () => {
    const pause = vi.fn();
    const play = vi.fn();
    const isPaused = vi.fn(() => false);
    const { result } = renderHook(() =>
      useEngagementGate({ pause, play, isPaused, isSequential: false, timeoutSeconds: 2 })
    );
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.gateOpen).toBe(false);
    expect(pause).not.toHaveBeenCalled();
  });

  it('opens the gate and pauses the video after the inactivity timeout', () => {
    const pause = vi.fn();
    const play = vi.fn();
    const isPaused = vi.fn(() => false);
    const { result } = renderHook(() =>
      useEngagementGate({ pause, play, isPaused, isSequential: true, timeoutSeconds: 2 })
    );
    act(() => { vi.advanceTimersByTime(2500); });
    expect(result.current.gateOpen).toBe(true);
    expect(pause).toHaveBeenCalled();
  });

  it('does not open the gate while the video is already paused', () => {
    const pause = vi.fn();
    const play = vi.fn();
    const isPaused = vi.fn(() => true);
    const { result } = renderHook(() =>
      useEngagementGate({ pause, play, isPaused, isSequential: true, timeoutSeconds: 2 })
    );
    act(() => { vi.advanceTimersByTime(2500); });
    expect(result.current.gateOpen).toBe(false);
  });

  it('dismissGate resumes the video, closes the gate, and fires onEngagementConfirmed', () => {
    const pause = vi.fn();
    const play = vi.fn();
    let paused = false;
    const isPaused = vi.fn(() => paused);
    const onConfirmed = vi.fn();
    const { result } = renderHook(() =>
      useEngagementGate({ pause, play, isPaused, isSequential: true, timeoutSeconds: 2, onEngagementConfirmed: onConfirmed })
    );
    act(() => { vi.advanceTimersByTime(2500); });
    expect(result.current.gateOpen).toBe(true);
    paused = true; // simulate that pause() took effect
    act(() => { result.current.dismissGate(); });
    expect(result.current.gateOpen).toBe(false);
    expect(play).toHaveBeenCalled();
    expect(onConfirmed).toHaveBeenCalled();
  });

  it('MIDI activity resets the idle timer (gate does not open if notes keep coming)', () => {
    const pause = vi.fn();
    const play = vi.fn();
    const isPaused = vi.fn(() => false);
    const { result, rerender } = renderHook(() =>
      useEngagementGate({ pause, play, isPaused, isSequential: true, timeoutSeconds: 3 })
    );
    // 2s pass, then a note is pressed (resets), then 2 more seconds — total 4s but never 3s idle
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { midiState.activeNotes = new Map([[60, { note: 60 }]]); rerender(); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.gateOpen).toBe(false);
  });
});
