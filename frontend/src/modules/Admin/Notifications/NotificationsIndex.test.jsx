import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));
import { NotificationsIndex } from './NotificationsIndex.jsx';

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);
beforeEach(() => {
  api.mockReset();
  api.mockImplementation((pathArg) => {
    if (String(pathArg).includes('/ledger')) return Promise.resolve({ events: [{ at: 2, username: 'kckern', category: 'ceremony', delivered: false, suppressed: true, reason: 'cooldown' }] });
    return Promise.resolve({ quiet_hours: { enabled: true, start: '21:00', end: '07:00' }, cooldowns: { ceremony: 1200, default: 60 } });
  });
});

describe('NotificationsIndex', () => {
  it('renders quiet hours, cooldowns, and the ledger', async () => {
    wrap(<NotificationsIndex />);
    expect(await screen.findByDisplayValue('21:00')).toBeInTheDocument();
    // Mantine NumberInput renders its value as an <input value=...>, not text
    // content, so getByText(/1200/) never matches — use getByDisplayValue.
    expect(screen.getByDisplayValue('1200')).toBeInTheDocument();       // ceremony cooldown
    // Case-sensitive: the "Cooldowns (minutes)" card heading also contains
    // "Cooldown" and would ambiguously match a case-insensitive /cooldown/i.
    await waitFor(() => expect(screen.getByText(/cooldown/)).toBeInTheDocument()); // ledger row reason
  });
  it('saves quiet hours via PUT', async () => {
    wrap(<NotificationsIndex />);
    await screen.findByDisplayValue('21:00');
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    // Real DaylightAPI signature is (path, data, method) — see frontend/src/lib/api.mjs.
    await waitFor(() => expect(api).toHaveBeenCalledWith(
      '/api/v1/admin/notifications',
      expect.objectContaining({ quiet_hours: expect.any(Object), cooldowns: expect.any(Object) }),
      'PUT'
    ));
  });
});
