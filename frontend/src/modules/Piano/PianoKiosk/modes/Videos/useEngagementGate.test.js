import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const midiState = { activeNotes: new Map() };
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => midiState,
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
    const mediaEl = { pause: vi.fn(), play: vi.fn(), paused: false };
    const { result } = renderHook(() =>
      useEngagementGate({ mediaEl, isSequential: false, timeoutSeconds: 2 })
    );
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.gateOpen).toBe(false);
    expect(mediaEl.pause).not.toHaveBeenCalled();
  });

  it('opens the gate and pauses the video after the inactivity timeout', () => {
    const mediaEl = { pause: vi.fn(), play: vi.fn(), paused: false };
    const { result } = renderHook(() =>
      useEngagementGate({ mediaEl, isSequential: true, timeoutSeconds: 2 })
    );
    act(() => { vi.advanceTimersByTime(2500); });
    expect(result.current.gateOpen).toBe(true);
    expect(mediaEl.pause).toHaveBeenCalled();
  });

  it('does not open the gate while the video is already paused', () => {
    const mediaEl = { pause: vi.fn(), play: vi.fn(), paused: true };
    const { result } = renderHook(() =>
      useEngagementGate({ mediaEl, isSequential: true, timeoutSeconds: 2 })
    );
    act(() => { vi.advanceTimersByTime(2500); });
    expect(result.current.gateOpen).toBe(false);
  });

  it('dismissGate resumes the video, closes the gate, and fires onEngagementConfirmed', () => {
    const mediaEl = { pause: vi.fn(), play: vi.fn(), paused: false };
    const onConfirmed = vi.fn();
    const { result } = renderHook(() =>
      useEngagementGate({ mediaEl, isSequential: true, timeoutSeconds: 2, onEngagementConfirmed: onConfirmed })
    );
    act(() => { vi.advanceTimersByTime(2500); });
    expect(result.current.gateOpen).toBe(true);
    // simulate the element being paused now
    mediaEl.paused = true;
    act(() => { result.current.dismissGate(); });
    expect(result.current.gateOpen).toBe(false);
    expect(mediaEl.play).toHaveBeenCalled();
    expect(onConfirmed).toHaveBeenCalled();
  });

  it('MIDI activity resets the idle timer (gate does not open if notes keep coming)', () => {
    const mediaEl = { pause: vi.fn(), play: vi.fn(), paused: false };
    const { result, rerender } = renderHook(() =>
      useEngagementGate({ mediaEl, isSequential: true, timeoutSeconds: 3 })
    );
    // 2s pass, then a note is pressed (resets), then 2 more seconds — total 4s but never 3s idle
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { midiState.activeNotes = new Map([[60, { note: 60 }]]); rerender(); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.gateOpen).toBe(false);
  });
});
