import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const notifyShow = vi.fn();
vi.mock('@mantine/notifications', () => ({ notifications: { show: (a) => notifyShow(a) } }));
const updateCadence = vi.fn(() => Promise.reject(new Error('Plan not found')));
vi.mock('../../hooks/useLifePlan.js', () => ({
  useCeremonyConfig: () => ({ config: { ceremonies: {} }, current: {}, loading: false, updateCadence }),
}));
import { CeremonyConfig } from './CeremonyConfig.jsx';

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);

describe('CeremonyConfig', () => {
  it('lists the daily capture ceremony so it can be disabled', () => {
    wrap(<CeremonyConfig />);
    expect(screen.getByText(/capture/i)).toBeInTheDocument();
  });
  it('notifies instead of silently failing when a toggle cannot save', async () => {
    wrap(<CeremonyConfig />);
    fireEvent.click(screen.getAllByRole('switch')[0]);
    await waitFor(() => expect(notifyShow).toHaveBeenCalled());
  });
});
