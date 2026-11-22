import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FeedPlayerProvider } from './FeedPlayerContext.jsx';
import FeedPlayerSheet from './FeedPlayerSheet.jsx';

it('preserves focus already inside the player when its opening timer runs', () => {
  vi.useFakeTimers();
  try {
    render(<FeedPlayerProvider>
      <FeedPlayerSheet open item={{ title: 'Track' }} />
    </FeedPlayerProvider>);
    const speed = screen.getByRole('button', { name: '2x', exact: true });
    speed.focus();
    expect(document.activeElement).toBe(speed);
    act(() => { vi.runOnlyPendingTimers(); });
    expect(document.activeElement).toBe(speed);
  } finally {
    vi.useRealTimers();
  }
});

it('maps Up and Down on the playback slider to bounded five-second seeks', () => {
  const seek = vi.fn();
  render(<FeedPlayerProvider>
    <FeedPlayerSheet open item={{ title: 'Track' }} playback={{ currentTime: 30, duration: 100, seek }} />
  </FeedPlayerProvider>);
  const slider = screen.getByRole('slider', { name: 'Playback position' });
  slider.focus();

  const up = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
  act(() => slider.dispatchEvent(up));
  expect(up.defaultPrevented).toBe(true);
  expect(seek).toHaveBeenNthCalledWith(1, 35);

  const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
  act(() => slider.dispatchEvent(down));
  expect(down.defaultPrevented).toBe(true);
  expect(seek).toHaveBeenNthCalledWith(2, 25);
  expect(seek).toHaveBeenCalledTimes(2);
});
