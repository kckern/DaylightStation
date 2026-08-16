import { describe, expect, it } from 'vitest';
import {
  clockState, elapsedBySide, formatClock, formatThink, moveDurations, resolveTiming,
} from './chessClock.js';

const move = (color, at) => ({ color, at, san: 'e4' });

describe('resolveTiming', () => {
  it('shows a count-up clock by default, since most games here are untimed', () => {
    expect(resolveTiming({}).mode).toBe('up');
  });

  it('keeps a zero increment rather than replacing it with the default', () => {
    // 0 is a real time control (no increment); `||` would discard it.
    expect(resolveTiming({ timing: { increment_ms: 0 } }).increment_ms).toBe(0);
  });

  it('refuses a mode it does not implement', () => {
    expect(resolveTiming({ timing: { mode: 'hourglass' } }).mode).toBe('up');
  });

  it('refuses a nonsensical initial time', () => {
    expect(resolveTiming({ timing: { initial_ms: -5 } }).initial_ms).toBe(600000);
    expect(resolveTiming({ timing: { initial_ms: 'soon' } }).initial_ms).toBe(600000);
  });
});

describe('moveDurations', () => {
  it('measures the first move from the start of the game', () => {
    expect(moveDurations([move('w', 1000)], 0)).toEqual([1000]);
  });

  it('measures each later move from the one before it', () => {
    const history = [move('w', 1000), move('b', 1500), move('w', 4000)];
    expect(moveDurations(history, 0)).toEqual([1000, 500, 2500]);
  });

  it('reports an untimed move as null rather than as zero', () => {
    // Games archived before timing existed have no `at`; inventing a duration
    // would put fiction into the analysis.
    expect(moveDurations([{ color: 'w' }], 0)).toEqual([null]);
  });

  it('does not charge the next move for a gap in the timestamps', () => {
    const history = [move('w', 1000), { color: 'b' }, move('w', 9000)];
    const durations = moveDurations(history, 0);
    expect(durations[1]).toBeNull();
    // Measured from the last KNOWN timestamp (1000), not treated as 8s of
    // thinking that belongs to someone else.
    expect(durations[2]).toBe(8000);
  });

  it('never reports a negative duration from clock skew', () => {
    expect(moveDurations([move('w', 500)], 1000)).toEqual([0]);
  });
});

describe('elapsedBySide', () => {
  it('bills each move to the side that played it', () => {
    const history = [move('w', 1000), move('b', 3000), move('w', 3500)];
    expect(elapsedBySide(history, 0)).toEqual({ w: 1500, b: 2000 });
  });
});

describe('clockState', () => {
  const history = [move('w', 1000), move('b', 3000)];

  it('draws nothing when the clock is switched off', () => {
    const state = clockState({ history, startedAt: 0, now: 5000, timing: { mode: 'off' } });
    expect(state.shown).toBe(false);
  });

  it('adds the running side\'s in-progress think to their total', () => {
    // White has spent 1000ms on their move; it has been White's turn again
    // since 3000, and it is now 5000.
    const state = clockState({ history, startedAt: 0, now: 5000, turn: 'w', timing: { mode: 'up' } });
    expect(state.w.elapsedMs).toBe(3000);
    expect(state.b.elapsedMs).toBe(2000);
  });

  it('freezes when the game is over, so the board agrees with the archive', () => {
    const state = clockState({
      history, startedAt: 0, now: 999999, turn: 'w', timing: { mode: 'up' }, gameOver: true,
    });
    expect(state.w.elapsedMs).toBe(1000);
  });

  it('counts down from the control and credits the increment per completed move', () => {
    const state = clockState({
      history, startedAt: 0, now: 3000, turn: 'w',
      timing: { mode: 'down', initial_ms: 60000, increment_ms: 2000 },
    });
    // White played one move: 60000 + 2000 - 1000 spent.
    expect(state.w.remainingMs).toBe(61000);
    expect(state.b.remainingMs).toBe(60000);
  });

  it('flags a side that has run out, and never shows negative time', () => {
    const state = clockState({
      history: [move('w', 90000)], startedAt: 0, now: 90000, turn: 'b',
      timing: { mode: 'down', initial_ms: 60000, increment_ms: 0 },
    });
    expect(state.w.flagged).toBe(true);
    expect(state.w.remainingMs).toBe(0);
  });

  it('never flags a count-up clock — there is nothing to run out of', () => {
    const state = clockState({
      history: [move('w', 9999999)], startedAt: 0, now: 9999999, turn: 'b', timing: { mode: 'up' },
    });
    expect(state.w.flagged).toBe(false);
  });

  it('runs the clock before the first move has been played', () => {
    const state = clockState({ history: [], startedAt: 0, now: 4000, turn: 'w', timing: { mode: 'up' } });
    expect(state.w.elapsedMs).toBe(4000);
    expect(state.b.elapsedMs).toBe(0);
  });
});

describe('formatClock', () => {
  it('drops the hours slot until there are hours to show', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65000)).toBe('1:05');
    expect(formatClock(600000)).toBe('10:00');
    expect(formatClock(3661000)).toBe('1:01:01');
  });

  it('shows a placeholder rather than a wrong time for no value', () => {
    expect(formatClock(null)).toBe('--:--');
  });
});

describe('formatThink', () => {
  it('is terse, and distinguishes instant from a second', () => {
    expect(formatThink(400)).toBe('<1s');
    expect(formatThink(4000)).toBe('4s');
    expect(formatThink(65000)).toBe('1m5s');
    expect(formatThink(120000)).toBe('2m');
  });
});
