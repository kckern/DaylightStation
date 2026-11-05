import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Count every evaluateLevel call (one per fixed step) and let a test force a fail.
const evalCtl = vi.hoisted(() => ({ calls: 0, failOnCall: null }));
vi.mock('./sideScrollerEngine.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    evaluateLevel: (world, lvl) => {
      evalCtl.calls += 1;
      if (evalCtl.failOnCall !== null && evalCtl.calls === evalCtl.failOnCall) return 'fail';
      return actual.evaluateLevel(world, lvl);
    },
  };
});

const { useSideScrollerGame } = await import('./useSideScrollerGame.js');

const STEP_MS = 1000 / 60;
const GAME_CONFIG = {
  levels: [{
    name: 'Clock', scroll_speed: 2, obstacle_interval_ms: 2500, obstacle_mix: { low: 1 },
    note_range: [60, 72], complexity: 'single', score_to_advance: 1e9,
  }],
};
const NO_NOTES = new Map();

// Controllable rAF: frames run only when the test calls frame(ts).
let rafQueue;
let rafSeq;
let nowMs;

function frame(ts) {
  const pending = rafQueue;
  rafQueue = new Map();
  act(() => { for (const cb of pending.values()) cb(ts); });
}

async function startPlaying() {
  const hook = renderHook(() => useSideScrollerGame(NO_NOTES, GAME_CONFIG));
  act(() => { hook.result.current.startGame(); });
  // Countdown: four 800 ms interval ticks, then PLAYING.
  act(() => { vi.advanceTimersByTime(800 * 4 + 10); });
  expect(hook.result.current.phase).toBe('PLAYING');
  expect(rafQueue.size).toBe(1);
  return hook;
}

beforeEach(() => {
  evalCtl.calls = 0;
  evalCtl.failOnCall = null;
  rafQueue = new Map();
  rafSeq = 0;
  nowMs = 1000;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  vi.stubGlobal('requestAnimationFrame', (cb) => { rafSeq += 1; rafQueue.set(rafSeq, cb); return rafSeq; });
  vi.stubGlobal('cancelAnimationFrame', (id) => { rafQueue.delete(id); });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useSideScrollerGame — fixed-step simulated clock', () => {
  it('a hidden-tab gap advances at most 0.1 s of simulated time (no burst)', async () => {
    const { result } = await startPlaying();
    frame(nowMs); // first frame: zero elapsed, zero steps
    expect(result.current.simMs).toBe(0);

    frame(nowMs + 5000); // tab was hidden for 5 s
    expect(result.current.simMs).toBeGreaterThan(0);
    expect(result.current.simMs).toBeLessThanOrEqual(100 + 1e-6);
    expect(evalCtl.calls).toBeLessThanOrEqual(6);
  });

  it('runs whole 1/60 s steps and carries the remainder', async () => {
    const { result } = await startPlaying();
    frame(nowMs + 10); // 10 ms: not yet a whole step
    expect(result.current.simMs).toBe(0);
    frame(nowMs + 20); // 20 ms total: one step, 3.33 ms carried
    expect(result.current.simMs).toBeCloseTo(STEP_MS, 6);
    expect(result.current.simMs).not.toBeCloseTo(20, 3);
    expect(evalCtl.calls).toBe(1);
  });

  it('stops stepping at the failing step and moves to DYING once', async () => {
    const { result } = await startPlaying();
    const phases = [];
    evalCtl.failOnCall = 9; // the 3rd step of the second 6-step frame

    frame(nowMs + 100); // 6 steps
    phases.push(result.current.phase);
    expect(evalCtl.calls).toBe(6);
    frame(nowMs + 200); // fails on its 3rd step
    phases.push(result.current.phase);

    expect(evalCtl.calls).toBe(9); // no step ran after the fail
    expect(result.current.simMs).toBeCloseTo(9 * STEP_MS, 6);
    expect(result.current.phase).toBe('DYING');
    expect(rafQueue.size).toBe(0); // the loop parked

    // Nothing more steps or re-fails while dying.
    frame(nowMs + 300);
    phases.push(result.current.phase);
    expect(evalCtl.calls).toBe(9);
    expect(phases).toEqual(['PLAYING', 'DYING', 'DYING']);
  });
});
