import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));
const showDayStatus = vi.fn(() => true);
vi.mock('../healthResources.js', () => ({ showDayStatus: (...a) => showDayStatus(...a) }));

import { DayCloseRow } from './DayCloseRow.jsx';

const r = (ui) => render(<MantineProvider>{ui}</MantineProvider>);
// Real row shape from GET /api/v1/health/day → data[] (counted rows carry calories)
const rows = (cal) => [{ uuid: 'a', kind: 'item', status: 'accepted', calories: cal, mealTime: 'afternoon' }];
// Real dayStatus shape from GET /api/v1/health/day
const open = (extra = {}) => ({ status: null, minCalories: 1200, today: '2026-09-24', ...extra });

// DaylightAPI's real failure shape (lib/api.mjs): message embeds the body, status attached.
const httpError = (status, body) => Object.assign(new Error(`HTTP ${status}: Bad Request - ${JSON.stringify(body)}`), { status });

describe('DayCloseRow', () => {
  // Braces matter: a function RETURNED from beforeEach runs as teardown, and
  // mockReset() returns the mock — it would be called once more after each test.
  beforeEach(() => { apiMock.mockReset(); showDayStatus.mockClear(); });

  it('flags a past day under the threshold as incomplete', () => {
    r(<DayCloseRow date="2026-09-16" dayStatus={open()} items={rows(460)} />);
    expect(screen.getByText(/Only 460 cal logged\. Coaching treats this day as incomplete/)).toBeTruthy();
    expect(document.querySelector('.health-dayclose--flagged')).toBeTruthy();
  });

  it('says "Nothing logged" for an empty past day', () => {
    r(<DayCloseRow date="2026-09-13" dayStatus={open()} items={[]} />);
    expect(screen.getByText(/^Nothing logged\./)).toBeTruthy();
  });

  it('shows nothing for a complete past day — the coach already trusts it', () => {
    r(<DayCloseRow date="2026-09-22" dayStatus={open()} items={rows(1606)} />);
    expect(document.querySelector('.health-dayclose')).toBeFalsy();
  });

  it("never flags today, and uses the SERVER's today", () => {
    r(<DayCloseRow date="2026-09-24" dayStatus={open()} items={rows(300)} />);
    expect(screen.getByText('Finished eating for today?')).toBeTruthy();
    expect(document.querySelector('.health-dayclose--flagged')).toBeFalsy();
  });

  it('Fasted posts the closure and patches the cached day with the server answer', async () => {
    const answer = { status: 'fasting', minCalories: 1200, today: '2026-09-24' };
    apiMock.mockResolvedValue(answer);
    const onChanged = vi.fn();
    r(<DayCloseRow date="2026-09-16" dayStatus={open()} items={rows(0)} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /Fasted/ }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/nutrition/day-status', { date: '2026-09-16', status: 'fasting' }, 'POST');
    expect(showDayStatus).toHaveBeenCalledWith('2026-09-16', answer);
  });

  it('renders whatever the server says — a /fast from Telegram wins over the page', () => {
    const view = r(<DayCloseRow date="2026-09-16" dayStatus={open({ status: 'done' })} items={rows(900)} />);
    expect(screen.getByText('Logging done')).toBeTruthy();
    view.rerender(<MantineProvider><DayCloseRow date="2026-09-16" dayStatus={open({ status: 'fasting' })} items={rows(900)} /></MantineProvider>);
    expect(screen.getByText('Fasting day')).toBeTruthy();
  });

  it('Reopen clears a closure', async () => {
    apiMock.mockResolvedValue({ status: null, minCalories: 1200, today: '2026-09-24' });
    r(<DayCloseRow date="2026-09-16" dayStatus={open({ status: 'done' })} items={rows(900)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('api/v1/health/nutrition/day-status', { date: '2026-09-16', status: null }, 'POST'));
  });

  it("shows the server's refusal sentence, not the raw HTTP text", async () => {
    apiMock.mockRejectedValue(httpError(400, { error: 'A future day cannot be closed' }));
    r(<DayCloseRow date="2026-09-16" dayStatus={open()} items={rows(500)} />);
    fireEvent.click(screen.getByRole('button', { name: /Done logging/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('A future day cannot be closed'));
    expect(screen.getByRole('button', { name: /Done logging/ })).toBeTruthy();
  });

  it('asks for a retry on a network or server failure', async () => {
    apiMock.mockRejectedValue(Object.assign(new Error('HTTP 502: Bad Gateway - <html>'), { status: 502 }));
    r(<DayCloseRow date="2026-09-16" dayStatus={open()} items={rows(500)} />);
    fireEvent.click(screen.getByRole('button', { name: /Fasted/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not save. Try again.'));
  });
});
