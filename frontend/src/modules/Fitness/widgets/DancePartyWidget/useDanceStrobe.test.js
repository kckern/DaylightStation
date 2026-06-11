import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useDanceStrobe,
  strobeFrame,
  pickOrientation,
  ORIENTATIONS,
  STROBE_HUE_GRADES,
  STROBE_HUE_STEP_DEG,
  STROBE_DIM_OPACITY
} from './useDanceStrobe.js';

describe('strobeFrame (pure beat math)', () => {
  it('beat 0 is bright at hue 0', () => {
    expect(strobeFrame(0)).toEqual({ hue: 0, bright: true, opacity: 1 });
  });

  it('alternates bright/dim every beat; dim is 20% opacity, never zero', () => {
    for (let beat = 0; beat < 14; beat++) {
      const f = strobeFrame(beat);
      expect(f.bright).toBe(beat % 2 === 0);
      expect(f.opacity).toBe(beat % 2 === 0 ? 1 : STROBE_DIM_OPACITY);
      expect(f.opacity).toBeGreaterThan(0);
    }
    expect(STROBE_DIM_OPACITY).toBe(0.2);
  });

  it('each beat crosses the wheel (180°) plus half a grade', () => {
    expect(STROBE_HUE_STEP_DEG).toBeCloseTo(180 + 360 / (2 * STROBE_HUE_GRADES), 6);
    expect(strobeFrame(1).hue).toBeCloseTo(STROBE_HUE_STEP_DEG, 1);
  });

  it('cycles exactly 7 distinct hue grades (including 0), each multiples of 360/7', () => {
    const hues = new Set();
    for (let beat = 0; beat < 14; beat++) hues.add(strobeFrame(beat).hue);
    expect(hues.size).toBe(STROBE_HUE_GRADES);
    for (const hue of hues) {
      const grade = hue / (360 / STROBE_HUE_GRADES);
      expect(grade).toBeCloseTo(Math.round(grade), 1);
    }
  });

  it('every hue grade appears in both bright and dim states across 14 beats', () => {
    const seen = new Map(); // hue -> Set of bright states
    for (let beat = 0; beat < 14; beat++) {
      const { hue, bright } = strobeFrame(beat);
      if (!seen.has(hue)) seen.set(hue, new Set());
      seen.get(hue).add(bright);
    }
    expect(seen.size).toBe(STROBE_HUE_GRADES);
    for (const states of seen.values()) {
      expect(states).toEqual(new Set([true, false]));
    }
  });

  it('returns to hue 0 bright after 14 beats (full cycle)', () => {
    expect(strobeFrame(14)).toEqual({ hue: 0, bright: true, opacity: 1 });
  });
});

describe('pickOrientation', () => {
  it('covers all four flip permutations (normal, mirror, upside-down, both)', () => {
    expect(ORIENTATIONS).toEqual(expect.arrayContaining([
      { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }
    ]));
    expect(ORIENTATIONS).toHaveLength(4);
  });

  it('always returns a DIFFERENT orientation than the current one', () => {
    for (const current of ORIENTATIONS) {
      for (let i = 0; i < 20; i++) {
        const next = pickOrientation(current);
        expect(ORIENTATIONS).toContainEqual(next);
        expect(next).not.toEqual(current);
      }
    }
  });

  it('is deterministic under an injected rng', () => {
    expect(pickOrientation({ x: 1, y: 1 }, () => 0)).toEqual({ x: -1, y: 1 });
    expect(pickOrientation({ x: 1, y: 1 }, () => 0.99)).toEqual({ x: -1, y: -1 });
  });
});

describe('useDanceStrobe', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts off with no style applied', () => {
    const { result } = renderHook(() => useDanceStrobe({ bpm: 60 }));
    expect(result.current.strobeOn).toBe(false);
    expect(result.current.strobeStyle).toBeNull();
  });

  it('toggling on yields bright hue-0 unflipped immediately, then beats at the configured bpm', () => {
    const { result } = renderHook(() => useDanceStrobe({ bpm: 60 }));
    act(() => result.current.toggleStrobe());
    expect(result.current.strobeOn).toBe(true);
    expect(result.current.strobeStyle).toEqual({ filter: 'hue-rotate(0deg)', opacity: 1, transform: 'scale(1, 1)' });

    act(() => vi.advanceTimersByTime(1000)); // 60 bpm = 1 beat/sec
    expect(result.current.strobeStyle.opacity).toBe(STROBE_DIM_OPACITY);
    expect(result.current.strobeStyle.filter).toBe(`hue-rotate(${strobeFrame(1).hue}deg)`);

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.strobeStyle.opacity).toBe(1);
    expect(result.current.strobeStyle.filter).toBe(`hue-rotate(${strobeFrame(2).hue}deg)`);
  });

  it('honors a faster bpm (120 → beat every 500ms)', () => {
    const { result } = renderHook(() => useDanceStrobe({ bpm: 120 }));
    act(() => result.current.toggleStrobe());
    act(() => vi.advanceTimersByTime(499));
    expect(result.current.strobeStyle.opacity).toBe(1);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.strobeStyle.opacity).toBe(STROBE_DIM_OPACITY);
  });

  it('toggling off removes the style and stops the beat clock', () => {
    const { result } = renderHook(() => useDanceStrobe({ bpm: 60 }));
    act(() => result.current.toggleStrobe());
    act(() => vi.advanceTimersByTime(3000));
    act(() => result.current.toggleStrobe());
    expect(result.current.strobeOn).toBe(false);
    expect(result.current.strobeStyle).toBeNull();
    const before = result.current.beatIndex;
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.beatIndex).toBe(before);
  });

  it('re-enabling restarts the cycle at hue 0 bright, unflipped', () => {
    const { result } = renderHook(() => useDanceStrobe({ bpm: 60 }));
    act(() => result.current.toggleStrobe());
    act(() => vi.advanceTimersByTime(3000));
    act(() => result.current.toggleStrobe()); // off
    act(() => result.current.toggleStrobe()); // on again
    expect(result.current.strobeStyle).toEqual({ filter: 'hue-rotate(0deg)', opacity: 1, transform: 'scale(1, 1)' });
  });

  it('re-orients on each light→dark transition, holding through the next bright beat', () => {
    // rng = 0 deterministically picks the first non-current orientation:
    // {1,1} → {-1,1} → {1,1} → ...
    const { result } = renderHook(() => useDanceStrobe({ bpm: 60, rng: () => 0 }));
    act(() => result.current.toggleStrobe());
    expect(result.current.strobeStyle.transform).toBe('scale(1, 1)');

    act(() => vi.advanceTimersByTime(1000)); // beat 1: dark — new orientation
    expect(result.current.strobeStyle.opacity).toBe(STROBE_DIM_OPACITY);
    expect(result.current.strobeStyle.transform).toBe('scale(-1, 1)');

    act(() => vi.advanceTimersByTime(1000)); // beat 2: bright — orientation held
    expect(result.current.strobeStyle.opacity).toBe(1);
    expect(result.current.strobeStyle.transform).toBe('scale(-1, 1)');

    act(() => vi.advanceTimersByTime(1000)); // beat 3: dark — re-orients again
    expect(result.current.strobeStyle.transform).toBe('scale(1, 1)');
  });

  it('orientation is always one of the four permutations under real randomness', () => {
    const { result } = renderHook(() => useDanceStrobe({ bpm: 60 }));
    act(() => result.current.toggleStrobe());
    const seen = new Set();
    for (let beat = 0; beat < 20; beat++) {
      act(() => vi.advanceTimersByTime(1000));
      seen.add(result.current.strobeStyle.transform);
    }
    const valid = ORIENTATIONS.map((o) => `scale(${o.x}, ${o.y})`);
    for (const transform of seen) expect(valid).toContain(transform);
  });

  it('falls back to 60 bpm on invalid input', () => {
    const { result } = renderHook(() => useDanceStrobe({ bpm: 0 }));
    act(() => result.current.toggleStrobe());
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.strobeStyle.opacity).toBe(STROBE_DIM_OPACITY);
  });
});
