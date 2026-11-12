import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import rhythmLoopSitting from '../../__fixtures__/humanNotes/rhythm-loop-sitting.json';

const listeners = new Set();
const midi = { subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));
const log = { info: vi.fn(), sampled: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => ({ default: () => ({ child: () => log }) }));
const api = vi.fn(async () => ({ legit: true, probability: 0.9, source: 'model' }));
vi.mock('../../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

import { useLessonPractice } from './useLessonPractice.js';
import { tallyPractice, classifyBurst } from '../../../../portable/practice/practiceScore.mjs';
import { goodFaithScore } from '../../../../portable/practice/goodFaith.mjs';

const T0 = 1_762_000_000_000;
const emit = (evt) => act(() => { for (const fn of listeners) fn(evt); });
const scaleUp = [60, 62, 64, 65, 67, 69, 71, 72];
function play(notes, start = 0, gap = 400) {
  notes.forEach((n, i) => {
    const t = T0 + start + i * gap + (i % 3) * 17;
    emit({ type: 'note_on', note: n, velocity: 55 + (i * 7) % 30, time: t });
    emit({ type: 'note_off', note: n, velocity: 0, time: t + 200 });
  });
}

beforeEach(() => { listeners.clear(); api.mockClear(); Object.values(log).forEach((f) => f.mockReset()); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useLessonPractice', () => {
  it('drum-loop notes do not count', () => {
    const { result } = renderHook(() => useLessonPractice({ enabled: true, isPlaying: true, targetNpm: 13 }));
    for (const [ms, note, velocity] of rhythmLoopSitting.notes.slice(0, 3000)) emit({ type: 'note_on', note, velocity, time: T0 + ms });
    const r = result.current.report();
    // The classifier needs ~20 s to recognise the loop; what slips through
    // before then is a 13–17 notes/s stream the practice weighting discards.
    expect(r.practiceNotes).toBeLessThan(10);
    expect(r.humanNotes).toBeLessThan(40);
  });

  it('a fist counts near zero; a melody counts in full', () => {
    const { result } = renderHook(() => useLessonPractice({ enabled: true, isPlaying: true, targetNpm: 13 }));
    for (let c = 0; c < 5; c++) for (let k = 0; k < 7; k++) emit({ type: 'note_on', note: 48 + k, velocity: 90, time: T0 + c * 500 + k * 2 });
    expect(result.current.report().practiceNotes).toBe(0);
    play([...scaleUp, ...scaleUp], 10000);
    expect(result.current.report().practiceNotes).toBe(16);
  });

  it('report() is cumulative and stable; playedSec grows only while playing', () => {
    const { result, rerender } = renderHook((p) => useLessonPractice(p), { initialProps: { enabled: true, isPlaying: true, targetNpm: 13 } });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.report().playedSec).toBe(5);
    rerender({ enabled: true, isPlaying: false, targetNpm: 13 });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.report().playedSec).toBe(5);
    const a = result.current.report();
    expect(result.current.report()).toEqual(a);
    expect(a.sittingId).toMatch(/^[a-z0-9-]{8,}$/);
  });

  it('notes during a check-in (and 3 s after its answer) are not practice', () => {
    const { result } = renderHook(() => useLessonPractice({ enabled: true, isPlaying: true, targetNpm: 13 }));
    act(() => { result.current.recordCheckIn({ open: true, scales: 0 }); });
    play(scaleUp, 0);
    act(() => { result.current.recordCheckIn({ open: false }); });
    expect(result.current.report().humanNotes).toBe(0);
    expect(result.current.report().checkIns).toBe(1);
  });

  it('burstSince counts only human notes and its verdict matches classifyBurst; runningScore matches goodFaithScore', () => {
    const { result } = renderHook(() => useLessonPractice({ enabled: true, isPlaying: true, targetNpm: 13 }));
    play([...scaleUp, 64, 62], 0);
    const b = result.current.burstSince(T0);
    expect(b.events).toHaveLength(10);
    expect(b.verdict).toBe(classifyBurst(b.events).verdict);
    expect(b.events[0].durMs).toBe(200);
    act(() => { vi.advanceTimersByTime(60000); });
    const r = result.current.report();
    expect(result.current.runningScore()).toBe(goodFaithScore({ practiceNotes: r.practiceNotes, playedSec: r.playedSec, targetNpm: 13 }));
  });

  it('preschool mode counts a fist', () => {
    const { result } = renderHook(() => useLessonPractice({ enabled: true, isPlaying: true, targetNpm: 13, preschool: true }));
    for (let k = 0; k < 7; k++) emit({ type: 'note_on', note: 48 + k, velocity: 90, time: T0 + k * 2 });
    expect(result.current.report().practiceNotes).toBe(7);
  });

  it('fires one end-of-lesson judge request for a borderline score, never blocking', () => {
    let percent = 50;
    const { result } = renderHook(() => useLessonPractice({ enabled: true, isPlaying: true, targetNpm: 10, thresholdPercent: 90, getPercent: () => percent, userId: 'kid' }));
    // 6 practice notes in under a minute against target 10 → raw 6 (borderline [5, 7))
    play(scaleUp.slice(0, 6), 0, 500);
    act(() => { vi.advanceTimersByTime(12000); });
    percent = 95;
    act(() => { vi.advanceTimersByTime(2000); });
    expect(api).toHaveBeenCalledTimes(1);
    const [path, body] = api.mock.calls[0];
    expect(path).toBe('api/v1/piano/users/kid/lesson-legit');
    expect(body.kind).toBe('end-of-lesson');
    expect(Object.keys(body.burst).sort()).toEqual(['notes', 'stats']);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(api).toHaveBeenCalledTimes(1);
    expect(result.current.report().legitChecks).toBe(1);
  });

  it('a clear score never asks the judge', () => {
    let percent = 95;
    renderHook(() => useLessonPractice({ enabled: true, isPlaying: true, targetNpm: 0, thresholdPercent: 90, getPercent: () => percent, userId: 'kid' }));
    act(() => { vi.advanceTimersByTime(3000); });
    expect(api).not.toHaveBeenCalled();
  });
});
