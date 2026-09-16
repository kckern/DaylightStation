import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FitnessTimer from './Timer.jsx';

// These two tests moved here from `modules/Gaming/platform/ui/Timer.test.jsx`
// on 2026-09-16, unchanged. They pin THIS component's behaviour, but they sat
// in the Gaming module and reached across with a `../../../Fitness/` import —
// which `shared/gaming/testing/importBoundaries.test.mjs` forbids, since
// generic Gaming is not allowed to depend on a native context. The violation
// went unseen for as long as the `shared/` tree sat outside the vitest gate.
// Nothing is skipped by the move: the same assertions run, from the side that
// owns the component.

afterEach(() => vi.useRealTimers());

it('preserves Fitness imperative countdown controls and completion callbacks', () => {
  vi.useFakeTimers();
  const ref = React.createRef();
  const tick = vi.fn();
  const done = vi.fn();
  render(<FitnessTimer ref={ref} initialSeconds={2} onTick={tick} onComplete={done} format="seconds" />);
  act(() => vi.advanceTimersByTime(1000));
  expect(ref.current.getTime()).toBe(2);
  act(() => ref.current.start());
  act(() => vi.advanceTimersByTime(1000));
  expect(ref.current.getTime()).toBe(1);
  expect(tick).toHaveBeenLastCalledWith(1);
  act(() => ref.current.pause());
  act(() => vi.advanceTimersByTime(2000));
  expect(ref.current.getTime()).toBe(1);
  act(() => ref.current.start());
  act(() => vi.advanceTimersByTime(1000));
  expect(ref.current.getTime()).toBe(0);
  expect(done).toHaveBeenCalledTimes(1);
  expect(tick).toHaveBeenCalledTimes(1);
  act(() => ref.current.reset());
  expect(ref.current.getTime()).toBe(2);
});

it('preserves count-up render props for Fitness', () => {
  vi.useFakeTimers();
  const tick = vi.fn();
  const done = vi.fn();
  render(
    <FitnessTimer initialSeconds={59} direction="up" autoStart onTick={tick} onComplete={done}>
      {({ seconds, isRunning, formatTime }) => <span>{formatTime(seconds)} {isRunning ? 'running' : 'paused'}</span>}
    </FitnessTimer>,
  );
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText('01:00 running')).toBeInTheDocument();
  expect(tick).toHaveBeenLastCalledWith(60);
  expect(done).not.toHaveBeenCalled();
});
