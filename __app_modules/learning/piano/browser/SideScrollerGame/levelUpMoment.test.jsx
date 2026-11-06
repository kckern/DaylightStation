import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MomentBanner } from '../../../../../__capabilities/gaming/browser/platform/ui/hud/index.js';

// Force a level advance on the first evaluated step, and only that one.
const evalCtl = vi.hoisted(() => ({ calls: 0, advanceOnCall: 1 }));
vi.mock('./sideScrollerEngine.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    evaluateLevel: (world, lvl) => {
      evalCtl.calls += 1;
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
      className="scroller-overlay__level-up"
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
    expect(screen.queryByRole('status')).toBeNull();

    frame(nowMs);
    frame(nowMs + 50); // a few fixed steps; the first one advances
    expect(game.level).toBe(1);

    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('LEVEL UP!');
    expect(banner.textContent).toContain('Canyon Run');
    expect(game.moment).toEqual({ key: 'level-1', title: 'LEVEL UP!', subtitle: 'Canyon Run' });

    act(() => { vi.advanceTimersByTime(1499); });
    expect(screen.queryByRole('status')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole('status')).toBeNull();
    expect(game.moment).toBeNull();
  });
});
