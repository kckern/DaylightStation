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
