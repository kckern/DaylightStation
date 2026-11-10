import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MomentBanner } from '../game-platform/chrome/index.js';

// Force a level advance on the first evaluated step, and only that one.
const evalCtl = vi.hoisted(() => ({ calls: 0, advanceOnCall: 1, failOnCall: null }));
vi.mock('./sideScrollerEngine.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    evaluateLevel: (world, lvl) => {
      evalCtl.calls += 1;
      if (evalCtl.calls === evalCtl.failOnCall) return 'fail';
      if (evalCtl.calls === evalCtl.advanceOnCall) return 'advance';
      return actual.evaluateLevel(world, lvl);
    },
  };
});

const { useSideScrollerGame } = await import('./useSideScrollerGame.js');

const LEVEL = {
  scroll_speed: 2, obstacle_interval_ms: 2500, obstacle_mix: { low: 1 },
  note_range: [60, 72], complexity: 'single', score_to_advance: 1e9,
};
const GAME_CONFIG = { levels: [{ ...LEVEL, name: 'Meadow' }, { ...LEVEL, name: 'Canyon Run' }] };
const NO_NOTES = new Map();

let rafQueue;
let rafSeq;
let nowMs;
let game;

function Harness() {
  game = useSideScrollerGame(NO_NOTES, GAME_CONFIG);
  return (
    <MomentBanner
      momentKey={game.moment?.key}
      title={game.moment?.title}
      subtitle={game.moment?.subtitle}
      className="side-scroller__level-up"
    />
  );
}

function frame(ts) {
  const pending = rafQueue;
  rafQueue = new Map();
  act(() => { for (const cb of pending.values()) cb(ts); });
}

beforeEach(() => {
  evalCtl.calls = 0;
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

describe('Side Scroller — LEVEL UP moment', () => {
  it('announces the next level on a real advance and clears after 1500 ms', () => {
    render(<Harness />);
    act(() => { game.startGame(); });
    act(() => { vi.advanceTimersByTime(800 * 4 + 10); });
    expect(game.phase).toBe('PLAYING');
    expect(document.querySelector('.side-scroller__level-up')).toBeNull();

    frame(nowMs);
    frame(nowMs + 50); // a few fixed steps; the first one advances
    expect(game.level).toBe(1);

    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('LEVEL UP!');
    expect(banner.textContent).toContain('Canyon Run');
    expect(game.moment).toEqual({ key: 'level-1', title: 'LEVEL UP!', subtitle: 'Canyon Run' });

    act(() => { vi.advanceTimersByTime(1499); });
    expect(document.querySelector('.side-scroller__level-up')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(document.querySelector('.side-scroller__level-up')).toBeNull();
    expect(game.moment).toBeNull();
  });
});

describe('Side Scroller — LEVEL UP never outlives the run', () => {
  beforeEach(() => {
    evalCtl.advanceOnCall = 1;
    evalCtl.failOnCall = null;
  });
  afterEach(() => {
    evalCtl.advanceOnCall = 1;
    evalCtl.failOnCall = null;
  });

  function playToFirstLevelUp() {
    render(<Harness />);
    act(() => { game.startGame(); });
    act(() => { vi.advanceTimersByTime(800 * 4 + 10); });
    frame(nowMs);
    frame(nowMs + 50);
    expect(game.level).toBe(1);
    expect(game.moment).not.toBeNull();
  }

  it('a fail shortly after a level-up clears the banner before the death burst', () => {
    playToFirstLevelUp();
    evalCtl.failOnCall = evalCtl.calls + 1;
    act(() => { vi.advanceTimersByTime(200); });
    frame(nowMs + 100);
    frame(nowMs + 150);
    expect(game.phase).toBe('DYING');
    expect(game.moment).toBeNull();
    expect(document.querySelector('.side-scroller__level-up')).toBeNull();
    // The cleared timer cannot fire a stale clear later either.
    act(() => { vi.advanceTimersByTime(1500); });
    expect(game.moment).toBeNull();
  });

  it('advancing past the last level clears the banner, and startGame after GAME_OVER leaves moment null', () => {
    playToFirstLevelUp();
    evalCtl.advanceOnCall = evalCtl.calls + 1;
    frame(nowMs + 100);
    frame(nowMs + 150);
    expect(game.phase).toBe('GAME_OVER');
    expect(game.moment).toBeNull();
    expect(document.querySelector('.side-scroller__level-up')).toBeNull();
    act(() => { game.startGame(); });
    expect(game.phase).toBe('STARTING');
    expect(game.moment).toBeNull();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(game.moment).toBeNull();
  });
});
