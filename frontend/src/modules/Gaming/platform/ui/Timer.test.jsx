import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Timer from './Timer.jsx';
afterEach(() => vi.useRealTimers());
it('resumes a deadline and completes once even when rerendered', () => {
  vi.useFakeTimers(); vi.setSystemTime(10000); const done = vi.fn();
  const view = render(<React.StrictMode><Timer deadline={12500} durationMs={60000} onComplete={done} format="seconds" /></React.StrictMode>);
  expect(screen.getByText('3')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(3000)); expect(screen.getByText('0')).toBeInTheDocument(); expect(done).toHaveBeenCalledTimes(1);
  view.rerender(<React.StrictMode><Timer deadline={12500} durationMs={60000} onComplete={() => done()} format="seconds" /></React.StrictMode>);
  act(() => vi.advanceTimersByTime(2000)); expect(done).toHaveBeenCalledTimes(1);
});

it('preserves Fitness imperative countdown controls and completion callbacks', async () => {
  const {default: FitnessTimer}=await import('../../../Fitness/shared/primitives/Timer/Timer.jsx');
  vi.useFakeTimers(); const ref=React.createRef(), tick=vi.fn(), done=vi.fn();
  render(<FitnessTimer ref={ref} initialSeconds={2} onTick={tick} onComplete={done} format="seconds" />);
  act(()=>vi.advanceTimersByTime(1000));expect(ref.current.getTime()).toBe(2);
  act(()=>ref.current.start());act(()=>vi.advanceTimersByTime(1000));expect(ref.current.getTime()).toBe(1);expect(tick).toHaveBeenLastCalledWith(1);
  act(()=>ref.current.pause());act(()=>vi.advanceTimersByTime(2000));expect(ref.current.getTime()).toBe(1);
  act(()=>ref.current.start());act(()=>vi.advanceTimersByTime(1000));expect(ref.current.getTime()).toBe(0);expect(done).toHaveBeenCalledTimes(1);expect(tick).toHaveBeenCalledTimes(1);
  act(()=>ref.current.reset());expect(ref.current.getTime()).toBe(2);
});
it('preserves count-up render props for Fitness', async () => {
  const {default: FitnessTimer}=await import('../../../Fitness/shared/primitives/Timer/Timer.jsx');
  vi.useFakeTimers();const tick=vi.fn(),done=vi.fn();
  render(<FitnessTimer initialSeconds={59} direction="up" autoStart onTick={tick} onComplete={done}>{({seconds,isRunning,formatTime})=><span>{formatTime(seconds)} {isRunning?'running':'paused'}</span>}</FitnessTimer>);
  act(()=>vi.advanceTimersByTime(1000));expect(screen.getByText('01:00 running')).toBeInTheDocument();expect(tick).toHaveBeenLastCalledWith(60);expect(done).not.toHaveBeenCalled();
});
