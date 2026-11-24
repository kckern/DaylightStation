import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const setCeremonyEnabled = vi.fn(() => Promise.reject(new Error('Plan not found')));
vi.mock("../../hooks/useLifePlan.js", () => ({
  useCeremonyConfig: () => ({ ceremonies: {}, current: {}, loading: false, readingBack: false, setCeremonyEnabled }),
}));
import { CeremonyConfig } from "./CeremonyConfig.jsx";

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);

describe('CeremonyConfig', () => {


  it('lists the daily capture ceremony so it can be disabled', () => {
    wrap(<CeremonyConfig />);
    expect(screen.getByRole('switch', { name: 'Daily Capture' })).toBeInTheDocument();
  });
  it('shows an error toast instead of silently failing when a toggle cannot save', async () => {
    wrap(<CeremonyConfig />);
    fireEvent.click(screen.getByRole('switch', { name: 'Unit Intention' }));
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent("Couldn't update ceremony");
    expect(toast).toHaveTextContent('Plan not found');
  });

  it('dismisses the error toast on request', async () => {
    wrap(<CeremonyConfig />);
    fireEvent.click(screen.getByRole('switch', { name: 'Unit Intention' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closes the error toast by itself after 8 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      wrap(<CeremonyConfig />);
      fireEvent.click(screen.getByRole('switch', { name: 'Unit Intention' }));
      await screen.findByRole('alert');
      // The toast rendered outside act, so its passive effect (the one that
      // starts the countdown) can still be queued behind the faked scheduler.
      // Flush it first, or the 8 s timer starts after the clock has moved on.
      await act(async () => {});
      await act(async () => { vi.advanceTimersByTime(8100); });
      expect(screen.queryByRole('alert')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('keeps a late write error in the visit that submitted it', async () => {
    const failed = Promise.withResolvers();
    setCeremonyEnabled.mockReturnValueOnce(failed.promise);
    const view = wrap(<CeremonyConfig key="amy" username="amy" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Daily Capture' }));
    view.rerender(<MantineProvider><CeremonyConfig key="bob" username="bob" /></MantineProvider>);
    await act(async () => failed.reject(new Error('Old member failure')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Daily Capture' })).toHaveAttribute('aria-disabled', 'false');
  });
});
