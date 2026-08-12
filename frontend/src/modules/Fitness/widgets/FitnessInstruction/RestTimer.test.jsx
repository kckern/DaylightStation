import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

// ── Mocks ───────────────────────────────────────────────────────────────────
// Cues must go through the SHARED unlock-on-gesture element (playCueOnce), never
// a freshly constructed Audio: the garage Firefox kiosk ships
// media.autoplay.default=1 and a new element has no user activation. Spying on
// playCueOnce is therefore also the assertion that we routed through it — and
// the Audio trap below fails loudly if anything constructs its own.
const cues = vi.hoisted(() => []);
vi.mock('@/modules/Fitness/player/hooks/useGovernanceAudioDuck.js', () => ({
  __esModule: true,
  playCueOnce: ({ sound } = {}) => { cues.push(sound); return true; }
}));

const logCalls = vi.hoisted(() => ({ debug: [], info: [], warn: [], error: [] }));
vi.mock('@/lib/logging/Logger.js', () => {
  const makeLogger = (ctx = {}) => {
    const push = (bucket) => (event, data) =>
      logCalls[bucket].push({ component: ctx.component ?? null, event, data });
    return {
      debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error'),
      sampled: push('debug'),
      child: (childCtx = {}) => makeLogger({ ...ctx, ...childCtx })
    };
  };
  const getLogger = () => makeLogger();
  const noop = () => {};
  return {
    default: getLogger, getLogger, configure: noop, resetSamplingState: noop,
    getRecentEvents: () => [], getConfig: () => ({}), startDiagnostics: noop,
    stopDiagnostics: noop, perfSnapshot: () => ({}), getStatus: () => ({})
  };
});

import RestTimer from './RestTimer.jsx';

const logsFor = (bucket, event) =>
  logCalls[bucket].filter((l) => l.component === 'rest-timer' && l.event === event);

const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });

describe('RestTimer', () => {
  let audioConstructed;
  let realAudio;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    cues.length = 0;
    ['debug', 'info', 'warn', 'error'].forEach((b) => { logCalls[b].length = 0; });
    // Trap: constructing an Audio here would be silent on the kiosk.
    audioConstructed = 0;
    realAudio = global.Audio;
    global.Audio = function TrapAudio() { audioConstructed += 1; };
  });

  afterEach(() => {
    vi.useRealTimers();
    global.Audio = realAudio;
  });

  it('shows the starting count and the surrounding exercise labels', () => {
    const { getByTestId } = render(
      <RestTimer seconds={60} afterLabel="Back Squat" nextLabel="Pull Up" />
    );
    expect(getByTestId('rest-timer-count').textContent).toBe('60');
    expect(getByTestId('rest-timer-after').textContent).toContain('Back Squat');
    expect(getByTestId('rest-timer-next').textContent).toContain('Pull Up');
  });

  it('counts down one second at a time', () => {
    const { getByTestId } = render(<RestTimer seconds={10} />);
    expect(getByTestId('rest-timer-count').textContent).toBe('10');
    tick(1000);
    expect(getByTestId('rest-timer-count').textContent).toBe('9');
    tick(1000);
    expect(getByTestId('rest-timer-count').textContent).toBe('8');
    tick(5000);
    expect(getByTestId('rest-timer-count').textContent).toBe('3');
  });

  it('auto-advances exactly when the rest is over, not before', () => {
    const onDone = vi.fn();
    render(<RestTimer seconds={5} onDone={onDone} />);

    // One tick short of the deadline: still resting.
    tick(4750);
    expect(onDone).not.toHaveBeenCalled();

    tick(250);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith('elapsed');

    // And it must not keep firing once the interval is torn down.
    tick(10000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('ends on the wall clock, so throttled/swallowed ticks cannot extend rest', () => {
    // Advance the CLOCK without running the interval — what a backgrounded or
    // throttled kiosk tab does. A decrement-per-tick implementation would still
    // think 60s remain; a deadline implementation is already done.
    const onDone = vi.fn();
    render(<RestTimer seconds={60} onDone={onDone} />);
    act(() => { vi.setSystemTime(Date.now() + 60000); });
    expect(onDone).not.toHaveBeenCalled(); // nothing has ticked yet
    tick(250);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('beeps on each of the last three seconds and plays the go cue at zero', () => {
    render(<RestTimer seconds={6} tickSound="tick.wav" goSound="go.wav" />);
    tick(2000);                       // 6 -> 4, outside the cue window
    expect(cues).toEqual([]);
    tick(1000);                       // -> 3
    expect(cues).toEqual(['tick.wav']);
    tick(1000);                       // -> 2
    expect(cues).toEqual(['tick.wav', 'tick.wav']);
    tick(1000);                       // -> 1
    expect(cues).toEqual(['tick.wav', 'tick.wav', 'tick.wav']);
    tick(1000);                       // -> 0
    expect(cues).toEqual(['tick.wav', 'tick.wav', 'tick.wav', 'go.wav']);
  });

  it('never constructs its own Audio element', () => {
    render(<RestTimer seconds={4} tickSound="tick.wav" goSound="go.wav" />);
    tick(4000);
    expect(cues.length).toBeGreaterThan(0); // cues really did play
    expect(audioConstructed).toBe(0);       // ...and not through a new Audio
  });

  it('stops its clock on unmount — no callback, no surviving timer', () => {
    const onDone = vi.fn();
    const { unmount } = render(<RestTimer seconds={30} onDone={onDone} />);
    tick(1000);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    tick(60000);
    expect(onDone).not.toHaveBeenCalled();
    expect(cues).toEqual([]); // no beeps from a dead component either
  });

  it('passes straight through a zero-length rest instead of parking on 0', () => {
    // expandWorkout only emits rest when restSeconds > 0, so this is defensive —
    // but a rest screen that never ends is a stuck kiosk.
    const onDone = vi.fn();
    render(<RestTimer seconds={0} onDone={onDone} />);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith('elapsed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs rest-start on mount and rest-end when it elapses', () => {
    render(<RestTimer seconds={3} afterLabel="Back Squat" nextLabel="Pull Up" />);
    const start = logsFor('info', 'rest-start');
    expect(start).toHaveLength(1);
    expect(start[0].data).toEqual({ seconds: 3, after: 'Back Squat', next: 'Pull Up' });
    expect(logsFor('info', 'rest-end')).toHaveLength(0);

    tick(3000);
    const end = logsFor('info', 'rest-end');
    expect(end).toHaveLength(1);
    expect(end[0].data).toEqual({ reason: 'elapsed', seconds: 3 });
  });

  it('logs rest-end as interrupted (once) when unmounted mid-rest', () => {
    const { unmount } = render(<RestTimer seconds={30} />);
    tick(1000);
    unmount();
    const end = logsFor('info', 'rest-end');
    expect(end).toHaveLength(1);
    expect(end[0].data).toEqual({ reason: 'interrupted', seconds: 30 });
  });

  it('does not log a second rest-end when unmounted after it already elapsed', () => {
    const { unmount } = render(<RestTimer seconds={2} />);
    tick(2000);
    expect(logsFor('info', 'rest-end').map((l) => l.data.reason)).toEqual(['elapsed']);
    unmount();
    expect(logsFor('info', 'rest-end').map((l) => l.data.reason)).toEqual(['elapsed']);
  });

  it('does not restart when the parent re-renders with a fresh onDone identity', () => {
    // The runner passes an inline arrow, so this happens on every parent render.
    let calls = 0;
    const { rerender, getByTestId } = render(
      <RestTimer seconds={10} onDone={() => { calls += 1; }} />
    );
    tick(4000);
    expect(getByTestId('rest-timer-count').textContent).toBe('6');
    rerender(<RestTimer seconds={10} onDone={() => { calls += 1; }} />);
    expect(getByTestId('rest-timer-count').textContent).toBe('6'); // clock survived
    expect(logsFor('info', 'rest-start')).toHaveLength(1);
    tick(6000);
    expect(calls).toBe(1);
  });

  it('marks the final three seconds urgent so the countdown reads without sound', () => {
    const { getByTestId } = render(<RestTimer seconds={5} />);
    expect(getByTestId('rest-timer').className).not.toContain('is-urgent');
    tick(2000); // 5 -> 3
    expect(getByTestId('rest-timer').className).toContain('is-urgent');
  });
});
