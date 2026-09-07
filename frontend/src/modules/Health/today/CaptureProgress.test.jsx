import { act, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CaptureProgress } from './CaptureProgress.jsx';
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('advances an estimate then switches to indefinite work without claiming completion', () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  render(<CaptureProgress startedAt={0} estimateMs={10000} />);
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  act(() => vi.advanceTimersByTime(5000));
  expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  act(() => vi.advanceTimersByTime(6000));
  expect(screen.getByText('Still analyzing…')).toBeTruthy();
  expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false);
  expect(screen.queryByText(/complete|success/i)).toBeNull();
});
it('keeps each recording independently identified', () => {
  render(<><CaptureProgress startedAt={Date.now()} label="Dinner recording" /><CaptureProgress startedAt={Date.now()} label="Lunch recording" /></>);
  expect(screen.getAllByRole('progressbar')).toHaveLength(2);
});
