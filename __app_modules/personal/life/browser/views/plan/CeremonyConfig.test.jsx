import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const notifyShow = vi.fn();
vi.mock('@mantine/notifications', () => ({ notifications: { show: (a) => notifyShow(a) } }));
const setCeremonyEnabled = vi.fn(() => Promise.reject(new Error('Plan not found')));
vi.mock("../../hooks/useLifePlan.js", () => ({
  useCeremonyConfig: () => ({ ceremonies: {}, current: {}, loading: false, readingBack: false, setCeremonyEnabled }),
}));
import { CeremonyConfig } from "./CeremonyConfig.jsx";

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);

describe('CeremonyConfig', () => {
  beforeEach(() => notifyShow.mockClear());

  it('lists the daily capture ceremony so it can be disabled', () => {
    wrap(<CeremonyConfig />);
    expect(screen.getByRole('switch', { name: 'Daily Capture' })).toBeInTheDocument();
  });
  it('notifies instead of silently failing when a toggle cannot save', async () => {
    wrap(<CeremonyConfig />);
    fireEvent.click(screen.getByRole('switch', { name: 'Unit Intention' }));
    await waitFor(() => expect(notifyShow).toHaveBeenCalled());
  });

  it('keeps a late write error in the visit that submitted it', async () => {
    const failed = Promise.withResolvers();
    setCeremonyEnabled.mockReturnValueOnce(failed.promise);
    const view = wrap(<CeremonyConfig key="amy" username="amy" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Daily Capture' }));
    view.rerender(<MantineProvider><CeremonyConfig key="bob" username="bob" /></MantineProvider>);
    await act(async () => failed.reject(new Error('Old member failure')));
    expect(notifyShow).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: 'Daily Capture' })).toHaveAttribute('aria-disabled', 'false');
  });
});
