import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { DayCloseRow } from './DayCloseRow.jsx';

const r = (ui) => render(<MantineProvider>{ui}</MantineProvider>);
// Real row shape from GET /api/v1/health/day → data[] (counted rows carry calories)
const rows = (cal) => [{ uuid: 'a', kind: 'item', status: 'accepted', calories: cal, mealTime: 'afternoon' }];
const OPEN = { status: null, minCalories: 1200 };

describe('DayCloseRow', () => {
  // Braces matter: a function RETURNED from beforeEach runs as teardown, and
  // mockReset() returns the mock — it would be called once more after each test.
  beforeEach(() => { apiMock.mockReset(); });

  it('flags a past day under the threshold as incomplete', () => {
    r(<DayCloseRow date="2026-09-16" today="2026-09-24" dayStatus={OPEN} items={rows(460)} />);
    expect(screen.getByText(/Only 460 cal logged/)).toBeTruthy();
    expect(document.querySelector('.health-dayclose--flagged')).toBeTruthy();
  });

  it('never flags today, however little is logged so far', () => {
    r(<DayCloseRow date="2026-09-24" today="2026-09-24" dayStatus={OPEN} items={rows(300)} />);
    expect(screen.getByText('Finished eating for today?')).toBeTruthy();
    expect(document.querySelector('.health-dayclose--flagged')).toBeFalsy();
  });

  it('Fasted posts the closure and shows the closed state', async () => {
    apiMock.mockResolvedValue({ status: 'fasting', minCalories: 1200 });
    const onChanged = vi.fn();
    r(<DayCloseRow date="2026-09-16" today="2026-09-24" dayStatus={OPEN} items={rows(0)} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /Fasted/ }));
    await waitFor(() => expect(screen.getByText('Fasting day')).toBeTruthy());
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/nutrition/day-status', { date: '2026-09-16', status: 'fasting' }, 'POST');
    expect(onChanged).toHaveBeenCalled();
  });

  it('Reopen clears a closure', async () => {
    apiMock.mockResolvedValue({ status: null, minCalories: 1200 });
    r(<DayCloseRow date="2026-09-16" today="2026-09-24" dayStatus={{ status: 'done', minCalories: 1200 }} items={rows(900)} />);
    expect(screen.getByText('Logging done')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Done logging/ })).toBeTruthy());
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/nutrition/day-status', { date: '2026-09-16', status: null }, 'POST');
  });

  it('keeps the buttons and says so when the save fails', async () => {
    apiMock.mockRejectedValue(new Error('A future day cannot be closed'));
    r(<DayCloseRow date="2026-09-16" today="2026-09-24" dayStatus={OPEN} items={rows(500)} />);
    fireEvent.click(screen.getByRole('button', { name: /Done logging/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('A future day cannot be closed'));
    expect(screen.getByRole('button', { name: /Done logging/ })).toBeTruthy();
  });
});
