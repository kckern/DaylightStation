import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { NeedsReviewSection } from './NeedsReviewSection.jsx';

function r(ui) { return render(<MantineProvider>{ui}</MantineProvider>); }

// Real envelope shape from GET /api/v1/health/nutrition/pending → { pending: [...] }
const PENDING = [
  {
    id: 'log-1',
    createdAt: '2026-09-02T11:42:00.000Z',
    source: 'telegram',
    mealTime: 'morning',
    items: [{ label: 'Oatmeal', calories: 210 }, { label: 'Banana', calories: 105 }],
  },
  {
    id: 'log-2',
    createdAt: '2026-09-02T14:05:00.000Z',
    source: 'scale',
    mealTime: 'afternoon',
    items: [{ label: 'Chicken breast', calories: 231 }],
  },
];

describe('NeedsReviewSection', () => {
  beforeEach(() => { apiMock.mockReset(); });

  it('renders nothing when there is no pending list', () => {
    r(<NeedsReviewSection pending={[]} onChanged={() => {}} />);
    expect(document.querySelector('.health-pending--needs-review')).toBeFalsy();
  });

  it('renders a NEEDS REVIEW row per pending log with items, kcal total, and source tag', () => {
    r(<NeedsReviewSection pending={PENDING} onChanged={() => {}} />);
    expect(screen.getByText('NEEDS REVIEW')).toBeTruthy();
    expect(screen.getByText('Oatmeal, Banana')).toBeTruthy();
    expect(screen.getByText(/315 kcal/)).toBeTruthy();
    expect(screen.getByText('Telegram')).toBeTruthy();
    expect(screen.getByText('Chicken breast')).toBeTruthy();
    expect(screen.getByText(/231 kcal/)).toBeTruthy();
    expect(screen.getByText('Scale')).toBeTruthy();
  });

  it('Accept posts {cmd:"a", id} to /nutrition/callback and calls onChanged', async () => {
    apiMock.mockResolvedValue({ messages: [], logged: true });
    const onChanged = vi.fn();
    r(<NeedsReviewSection pending={[PENDING[0]]} onChanged={onChanged} />);

    fireEvent.click(screen.getAllByRole('button', { name: /accept/i })[0]);

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith(
      'api/v1/health/nutrition/callback',
      { callbackData: JSON.stringify({ cmd: 'a', id: 'log-1' }) },
      'POST',
    );
  });

  it('Discard posts {cmd:"x", id} to /nutrition/callback and calls onChanged', async () => {
    apiMock.mockResolvedValue({ messages: [], logged: false });
    const onChanged = vi.fn();
    r(<NeedsReviewSection pending={[PENDING[1]]} onChanged={onChanged} />);

    fireEvent.click(screen.getAllByRole('button', { name: /discard/i })[0]);

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith(
      'api/v1/health/nutrition/callback',
      { callbackData: JSON.stringify({ cmd: 'x', id: 'log-2' }) },
      'POST',
    );
  });

  it('a failed callback surfaces the error instead of silently clearing the row', async () => {
    apiMock.mockRejectedValue(new Error('network down'));
    const onChanged = vi.fn();
    r(<NeedsReviewSection pending={[PENDING[0]]} onChanged={onChanged} />);

    fireEvent.click(screen.getAllByRole('button', { name: /accept/i })[0]);

    await waitFor(() => expect(screen.getByText(/network down/)).toBeTruthy());
    expect(onChanged).not.toHaveBeenCalled();
  });
});
