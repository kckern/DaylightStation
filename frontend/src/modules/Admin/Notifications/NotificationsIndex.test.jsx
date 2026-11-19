import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  it('keeps the ledger available while retrying settings', async () => {
    api.mockRejectedValueOnce(new Error('Unavailable'));
    wrap(<NotificationsIndex />);
    expect(await screen.findByText('Notification settings failed to load')).toBeInTheDocument();
    expect(await screen.findByText('kckern')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByDisplayValue('21:00')).toBeInTheDocument();
  });

  it('preserves the settings draft through a failed ledger refresh and retry', async () => {
    wrap(<NotificationsIndex />);
    await screen.findByText('kckern');
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '20:00' } });
    api.mockRejectedValueOnce(new Error('Unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Recent activity failed to load')).toBeInTheDocument();
    api.mockResolvedValueOnce({ events: [{ at: 3, username: 'recovered', category: 'test' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('recovered')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByDisplayValue('20:00')).toBeInTheDocument();
  });

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
  it('keeps edits made during a save for the next explicit save', async () => {
    wrap(<NotificationsIndex />);
    await screen.findByDisplayValue('21:00');
    const start = screen.getByLabelText('Start');
    const end = screen.getByLabelText('End');
    const save = screen.getByRole('button', { name: 'Save' });
    fireEvent.change(start, { target: { value: '20:00' } });
    let finish;
    api.mockImplementationOnce((_path, submitted) => new Promise(resolve => { finish = () => resolve(submitted); }));
    fireEvent.click(save);
    fireEvent.change(end, { target: { value: '08:30' } });
    await act(async () => finish());
    expect(end).toHaveValue('08:30');
    expect(api.mock.calls.filter(([, , method]) => method === 'PUT')).toHaveLength(1);

    fireEvent.click(save);
    await waitFor(() => expect(api).toHaveBeenLastCalledWith('/api/v1/admin/notifications', {
      quiet_hours: { enabled: true, start: '20:00', end: '08:30' },
      cooldowns: { ceremony: 1200, default: 60 },
    }, 'PUT'));
  });

  it('saves quiet hours via PUT', async () => {
    wrap(<NotificationsIndex />);
    await screen.findByDisplayValue('21:00');
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '20:00' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    // Real DaylightAPI signature is (path, data, method) — see frontend/src/lib/api.mjs.
    await waitFor(() => expect(api).toHaveBeenCalledWith(
      '/api/v1/admin/notifications',
      expect.objectContaining({ quiet_hours: expect.any(Object), cooldowns: expect.any(Object) }),
      'PUT'
    ));
  });

  it('keeps refused edits dirty and reverts to the confirmed configuration without writing', async () => {
    wrap(<NotificationsIndex />);
    const start = await screen.findByLabelText('Start');
    const save = screen.getByRole('button', { name: 'Save', exact: true });
    expect(save).toBeDisabled();
    fireEvent.change(start, { target: { value: '20:00' } });
    api.mockRejectedValueOnce(new Error('Settings refused'));
    fireEvent.click(save);
    expect(await screen.findByText('Settings refused')).toBeVisible();
    expect(start).toHaveValue('20:00');
    expect(screen.getByText('Unsaved', { exact: true })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Revert', exact: true }));
    expect(start).toHaveValue('21:00');
    expect(save).toBeDisabled();
    expect(screen.queryByText('Settings refused')).toBeNull();
    expect(api.mock.calls.filter(([, , method]) => method === 'PUT')).toHaveLength(1);
  });
});
