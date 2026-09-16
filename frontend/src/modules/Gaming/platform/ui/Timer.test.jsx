import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Timer from './Timer.jsx';

// The two Fitness-parity tests that used to live here moved to
// `modules/Fitness/shared/primitives/Timer/Timer.test.jsx` on 2026-09-16. They
// imported `../../../Fitness/` from inside generic Gaming, which
// `shared/gaming/testing/importBoundaries.test.mjs` forbids — and which nothing
// caught while the `shared/` tree sat outside the vitest gate.

afterEach(() => vi.useRealTimers());

it('resumes a deadline and completes once even when rerendered', () => {
  vi.useFakeTimers(); vi.setSystemTime(10000); const done = vi.fn();
  const view = render(<React.StrictMode><Timer deadline={12500} durationMs={60000} onComplete={done} format="seconds" /></React.StrictMode>);
  expect(screen.getByText('3')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(3000)); expect(screen.getByText('0')).toBeInTheDocument(); expect(done).toHaveBeenCalledTimes(1);
  view.rerender(<React.StrictMode><Timer deadline={12500} durationMs={60000} onComplete={() => done()} format="seconds" /></React.StrictMode>);
  act(() => vi.advanceTimersByTime(2000)); expect(done).toHaveBeenCalledTimes(1);
});
