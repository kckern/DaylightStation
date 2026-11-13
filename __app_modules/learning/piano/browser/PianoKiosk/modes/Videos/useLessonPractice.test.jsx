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
import { createHumanNoteClassifier as makeClassifier } from '../../humanNoteClassifier.js';
import { tallyPractice, classifyBurst } from '../../../../portable/practice/practiceScore.mjs';
import { normaliseGoodFaithState } from '../../../../portable/practice/sittingGoodFaith.mjs';

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

beforeEach(() => { listeners.clear(); api.mockClear(); Object.values(log).forEach((f) => f.mockReset()); vi.useFakeTimers(); vi.setSystemTime(T0); });
afterEach(() => { vi.useRealTimers(); });

describe('useLessonPractice', () => {
  it('drum-loop notes do not count', () => {
    const { result } = renderHook(() => useLessonPractice({ enabled: true, isPlaying: true, enforced: true }));
    for (const [ms, note, velocity] of rhythmLoopSitting.notes.slice(0, 3000)) emit({ type: 'note_on', note, velocity, time: T0 + ms });
    const r = result.current.report();
    // The classifier needs ~20 s to recognise the loop; what slips through
    // before then is a 13–17 notes/s stream the practice weighting discards.
    expect(r.practiceNotes).toBeLessThan(10);
    expect(r.humanNotes).toBeLessThan(40);
  });

  it('a fist counts near zero; a melody counts in full', () => {
    const { result } = renderHook(() => useLessonPractice({ enabled: true, isPlaying: true, enforced: true }));
    for (let c = 0; c < 5; c++) for (let k = 0; k < 7; k++) emit({ type: 'note_on', note: 48 + k, velocity: 90, time: T0 + c * 500 + k * 2 });
    expect(result.current.report().practiceNotes).toBe(0);
    play([...scaleUp, ...scaleUp], 10000);
    expect(result.current.report().practiceNotes).toBe(16);
  });

  it('report() is cumulative and stable; playedSec grows only while playing', () => {
    const { result, rerender } = renderHook((p) => useLessonPractice(p), { initialProps: { enabled: true, isPlaying: true, enforced: true } });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.report().playedSec).toBe(5);
    rerender({ enabled: true, isPlaying: false, enforced: true });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.report().playedSec).toBe(5);
    const a = result.current.report();
    expect(result.current.report()).toEqual(a);
    expect(a.sittingId).toMatch(/^[a-z0-9-]{8,}$/);
  });

  it('notes during a check-in (and 3 s after its answer) are not practice', () => {
    const { result } = renderHook(() => useLessonPractice({ enabled: true, isPlaying: true, enforced: true }));
    act(() => { result.current.recordCheckIn({ open: true, scales: 0 }); });
    play(scaleUp, 0);
    act(() => { result.current.recordCheckIn({ open: false }); });
    expect(result.current.report().humanNotes).toBe(0);
    expect(result.current.report().checkIns).toBe(1);
  });

  it('burstSince counts only human notes and its verdict matches classifyBurst', () => {
    const { result } = renderHook(() => useLessonPractice({ enabled: true, isPlaying: true, enforced: true }));
    play([...scaleUp, 64, 62], 0);
    const b = result.current.burstSince(T0);
    expect(b.events).toHaveLength(10);
    expect(b.verdict).toBe(classifyBurst(b.events).verdict);
    expect(b.events[0].durMs).toBe(200);
  });

  it('preschool mode counts a fist', () => {
    const { result } = renderHook(() => useLessonPractice({ enabled: true, isPlaying: true, enforced: true, preschool: true }));
    for (let k = 0; k < 7; k++) emit({ type: 'note_on', note: 48 + k, velocity: 90, time: T0 + k * 2 });
    expect(result.current.report().practiceNotes).toBe(7);
  });

  it('past the watch threshold the report carries the sitting\'s good-faith state — the minimal MIDI log', () => {
    let percent = 50;
    const { result } = renderHook(() => useLessonPractice({
      enabled: true, isPlaying: true, enforced: true, thresholdPercent: 90, getPercent: () => percent, getDurationSec: () => 600,
    }));
    play(scaleUp, 5000);
    act(() => { result.current.recordCheckIn({ open: true, scales: 1 }); });
    act(() => { vi.advanceTimersByTime(4000); });
    act(() => { result.current.recordCheckIn({ open: false }); });
    expect(result.current.report().goodFaith).toBeUndefined();
    expect(result.current.report().checkInsAnswered).toBe(1);
    percent = 92;
    const r = result.current.report();
    expect(r.goodFaith).toEqual(normaliseGoodFaithState(r.goodFaith));
    expect(r.goodFaith.notes).toHaveLength(8);
    expect(r.goodFaith.notes[0]).toMatchObject({ pitch: 60, onsetMs: 5000, durMs: 200 });
    expect(r.goodFaith.lesson).toMatchObject({ lengthMin: 10, preschool: false, notesPlayed: 8 });
    expect(r.goodFaith.presence).toEqual({ checkIns: 1, answered: 1, log: [expect.objectContaining({ asked: 'scale', answered: true })] });
    expect(api).not.toHaveBeenCalled();
  });

  it('the report carries the sitting\'s presence ladder: peak rung and answered minimal check-ins', () => {
    const { result } = renderHook(() => useLessonPractice({ enabled: true, isPlaying: true, enforced: true }));
    expect(result.current.report()).toMatchObject({ peakRung: 0, minimalCheckIns: 0 });
    act(() => { result.current.recordCheckIn({ open: true, scales: 0, rung: 0, minimal: false }); });
    act(() => { result.current.recordCheckIn({ open: false }); });
    act(() => { result.current.recordCheckIn({ open: true, scales: 2, rung: 2, minimal: true }); });
    act(() => { result.current.recordCheckIn({ open: false }); });
    expect(result.current.report()).toMatchObject({ peakRung: 2, minimalCheckIns: 1 });
    // An unanswered minimal check-in raises the peak but is not counted as minimal effort.
    act(() => { result.current.recordCheckIn({ open: true, scales: 1, rung: 3, minimal: true }); });
    expect(result.current.report()).toMatchObject({ peakRung: 3, minimalCheckIns: 1 });
    expect(result.current.report()).not.toHaveProperty('presence');
  });

  it('a malformed rung never reaches the report as NaN', () => {
    const { result } = renderHook(() => useLessonPractice({ enabled: true, isPlaying: true, enforced: true }));
    act(() => { result.current.recordCheckIn({ open: true, scales: 1, rung: 'x', minimal: 'yes' }); });
    act(() => { result.current.recordCheckIn({ open: false }); });
    expect(result.current.report()).toMatchObject({ peakRung: 0, minimalCheckIns: 0 });
  });

  it('an unenforced lesson never sends a state', () => {
    const { result } = renderHook(() => useLessonPractice({ enabled: true, isPlaying: true, enforced: false, thresholdPercent: 90, getPercent: () => 99 }));
    play(scaleUp, 0);
    expect(result.current.report().goodFaith).toBeUndefined();
  });

  it('loop notes taken back leave the sitting log too', () => {
    const { result } = renderHook(() => useLessonPractice({ enabled: true, isPlaying: true, enforced: true, thresholdPercent: 90, getPercent: () => 99, getDurationSec: () => 900 }));
    for (const [ms, note, velocity] of rhythmLoopSitting.notes.slice(0, 3000)) emit({ type: 'note_on', note, velocity, time: T0 + ms });
    expect(result.current.report().goodFaith.lesson.notesPlayed).toBeLessThan(10);
  });

  it('external mode: no own subscription; ingest() takes the loop back exactly as the subscribed path does', () => {
    const opts = { enabled: true, isPlaying: true, enforced: true, thresholdPercent: 90, getPercent: () => 99, getDurationSec: () => 900 };
    const ext = renderHook(() => useLessonPractice({ ...opts, external: true }));
    expect(listeners.size).toBe(0);
    const own = renderHook(() => useLessonPractice(opts));
    expect(listeners.size).toBe(1);
    const c = makeClassifier();
    const feed = (evt) => {
      for (const fn of listeners) fn(evt);
      const on = evt.type === 'note_on' && evt.velocity > 0;
      ext.result.current.ingest(evt, on ? c.classify(evt) : null, c.loopPitches);
    };
    act(() => {
      for (const [ms, note, velocity] of rhythmLoopSitting.notes.slice(0, 3000)) feed({ type: 'note_on', note, velocity, time: T0 + ms });
      scaleUp.forEach((n, i) => {
        feed({ type: 'note_on', note: n, velocity: 60 + i, time: T0 + 400_000 + i * 400 });
        feed({ type: 'note_off', note: n, velocity: 0, time: T0 + 400_000 + i * 400 + 200 });
      });
    });
    const a = ext.result.current.report();
    const b = own.result.current.report();
    expect(a.humanNotes).toBe(b.humanNotes);
    expect(a.practiceNotes).toBe(b.practiceNotes);
    expect(a.goodFaith.lesson.notesPlayed).toBe(b.goodFaith.lesson.notesPlayed);
    expect(log.info).toHaveBeenCalledWith('piano.lesson-practice.loop-retracted', expect.anything());
  });
});
