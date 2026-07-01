/**
 * useLoopTransport — smoke tests for the refs exposed from the hook.
 * These are intentionally minimal: the hook drives rAF + MIDI which are
 * hard to exercise in jsdom, so we just confirm the returned shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock the loop scheduler so it returns a predictable cycle in jsdom.
vi.mock('@shared-music/loopScheduler.mjs', () => ({
  buildLoopCycle: () => ({ events: [], lengthMs: 4000 }),
}));

import { useLoopTransport } from './useLoopTransport.js';

const pressNote = vi.fn();
const releaseNote = vi.fn();

beforeEach(() => {
  pressNote.mockClear();
  releaseNote.mockClear();
});

describe('useLoopTransport', () => {
  it('returns positionRef (a ref object) that starts at 0', () => {
    const { result } = renderHook(() =>
      useLoopTransport({ layers: [], bpm: 120, pressNote, releaseNote }),
    );
    expect(result.current.positionRef).toBeDefined();
    expect(typeof result.current.positionRef).toBe('object');
    expect(result.current.positionRef.current).toBe(0);
  });

  it('returns loopNotesRef (a ref object holding a Set)', () => {
    const { result } = renderHook(() =>
      useLoopTransport({ layers: [], bpm: 120, pressNote, releaseNote }),
    );
    expect(result.current.loopNotesRef).toBeDefined();
    expect(result.current.loopNotesRef.current).toBeInstanceOf(Set);
  });
});
