import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));
const showDayStatus = vi.fn(() => true);
vi.mock('../healthResources.js', () => ({ showDayStatus: (...a) => showDayStatus(...a) }));

import { DayClosePill } from './DayClosePill.jsx';

const r = (ui) => render(<MantineProvider>{ui}</MantineProvider>);
// Real row shape from GET /api/v1/health/day → data[] (counted rows carry calories)
const rows = (cal) => [{ uuid: 'a', kind: 'item', status: 'accepted', calories: cal, mealTime: 'afternoon' }];
// Real dayStatus shape from GET /api/v1/health/day
const open = (extra = {}) => ({ status: null, minCalories: 1200, today: '2026-09-24', ...extra });

// DaylightAPI's real failure shape (lib/api.mjs): message embeds the body, status attached.
const httpError = (status, body) => Object.assign(new Error(`HTTP ${status}: Bad Request - ${JSON.stringify(body)}`), { status });

describe('DayClosePill', () => {
  // Braces matter: a function RETURNED from beforeEach runs as teardown, and
  // mockReset() returns the mock — it would be called once more after each test.
  beforeEach(() => { apiMock.mockReset(); showDayStatus.mockClear(); });

  const choose = async (item) => {
    fireEvent.click(screen.getByTestId('dayclose-pill'));
    fireEvent.click(await screen.findByRole('menuitem', { name: item }));
  };

  it('flags a past day under the threshold, quietly: a tinted pill, not a banner', () => {
    r(<DayClosePill date="2026-09-16" dayStatus={open()} items={rows(460)} />);
    const pill = screen.getByTestId('dayclose-pill');
    expect(pill.textContent).toMatch(/Only 460 cal logged/);
    expect(pill.className).toMatch(/dayclose-pill--flagged/);
  });

  it('says "Nothing logged" for an empty past day', () => {
    r(<DayClosePill date="2026-09-13" dayStatus={open()} items={[]} />);
    expect(screen.getByTestId('dayclose-pill').textContent).toMatch(/Nothing logged/);
  });

  it('shows nothing for a complete past day — the coach already trusts it', () => {
    r(<DayClosePill date="2026-09-22" dayStatus={open()} items={rows(1606)} />);
    expect(screen.queryByTestId('dayclose-pill')).toBeNull();
  });

  it("never flags today, and uses the SERVER's today", () => {
    r(<DayClosePill date="2026-09-24" dayStatus={open()} items={rows(300)} />);
    const pill = screen.getByTestId('dayclose-pill');
    expect(pill.textContent).toMatch(/Close day/);
    expect(pill.className).not.toMatch(/--flagged/);
  });

  it('Fasted posts the closure and patches the cached day with the server answer', async () => {
    const answer = { status: 'fasting', minCalories: 1200, today: '2026-09-24' };
    apiMock.mockResolvedValue(answer);
    const onChanged = vi.fn();
    r(<DayClosePill date="2026-09-16" dayStatus={open()} items={rows(0)} onChanged={onChanged} />);
    await choose(/Fasted/);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('api/v1/health/nutrition/day-status', { date: '2026-09-16', status: 'fasting' }, 'POST');
    expect(showDayStatus).toHaveBeenCalledWith('2026-09-16', answer);
  });

  it('renders whatever the server says — a /fast from Telegram wins over the page', () => {
    const view = r(<DayClosePill date="2026-09-16" dayStatus={open({ status: 'done' })} items={rows(900)} />);
    expect(screen.getByTestId('dayclose-pill').textContent).toMatch(/Logging done/);
    view.rerender(<MantineProvider><DayClosePill date="2026-09-16" dayStatus={open({ status: 'fasting' })} items={rows(900)} /></MantineProvider>);
    expect(screen.getByTestId('dayclose-pill').textContent).toMatch(/Fasted/);
  });

  it('Reopen clears a closure', async () => {
    apiMock.mockResolvedValue({ status: null, minCalories: 1200, today: '2026-09-24' });
    r(<DayClosePill date="2026-09-16" dayStatus={open({ status: 'done' })} items={rows(900)} />);
    await choose(/Reopen day/);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('api/v1/health/nutrition/day-status', { date: '2026-09-16', status: null }, 'POST'));
  });

  it("shows the server's refusal sentence, not the raw HTTP text", async () => {
    apiMock.mockRejectedValue(httpError(400, { error: 'A future day cannot be closed' }));
    r(<DayClosePill date="2026-09-16" dayStatus={open()} items={rows(500)} />);
    await choose(/Done logging/);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('A future day cannot be closed'));
  });

  it('asks for a retry on a network or server failure', async () => {
    apiMock.mockRejectedValue(Object.assign(new Error('HTTP 502: Bad Gateway - <html>'), { status: 502 }));
    r(<DayClosePill date="2026-09-16" dayStatus={open()} items={rows(500)} />);
    await choose(/Fasted/);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not save. Try again.'));
  });
});
