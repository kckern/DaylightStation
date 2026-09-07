import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));
import { PendingReviewEditor } from './PendingReviewEditor.jsx';
const entry = { id: 'shake', version: 'v1', date: '2026-09-04', mealTime: 'afternoon',
  items: [{ id: 'item', label: 'Shake', calories: 160, protein: 30, sodium: 200, grams: null }] };
const renderReview = props => render(<MantineProvider><PendingReviewEditor entry={entry} onClose={vi.fn()} onChanged={vi.fn()} {...props} /></MantineProvider>);
describe('pending review editor', () => {
  beforeEach(() => { api.mockReset(); });
  it('edits portions and date before confirmation and scales the displayed nutrients', async () => {
    api.mockResolvedValue({ success: true });
    renderReview();
    fireEvent.change(screen.getByLabelText('Servings'), { target: { value: '0.5' } });
    expect(screen.getByLabelText('Calories (kcal)')).toHaveValue('80');
    fireEvent.click(screen.getByRole('button', { name: 'More nutrients' }));
    expect(screen.getByLabelText('Sodium (mg)')).toHaveValue('100');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-03' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm food' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('api/v1/health/nutrition/pending/shake/review',
      expect.objectContaining({ portionFactor: 0.5, date: '2026-09-03', expectedVersion: 'v1', action: 'confirm', operationId: expect.any(String) }), 'POST'));
  });
  it('reuses the operation ID on retry and retains the draft on a background update', async () => {
    const gatewayError = Object.assign(new Error('HTTP 502: Bad Gateway - <html>upstream failed</html>'), { status: 502 });
    api.mockRejectedValue(gatewayError);
    const view = renderReview();
    fireEvent.change(screen.getByLabelText('Food name'), { target: { value: 'Edited shake' } });
    view.rerender(<MantineProvider><PendingReviewEditor entry={entry} onClose={vi.fn()} onChanged={vi.fn()} /></MantineProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm food' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The server is temporarily unavailable. Your changes are still here. Try confirming again.');
    expect(screen.getByLabelText('Food name')).toHaveValue('Edited shake');
    expect(api).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm food' }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(api.mock.calls[0][1]).toEqual(api.mock.calls[1][1]);
    expect(api.mock.calls[0][1].items).toEqual([{ id: 'item', label: 'Edited shake' }]);
  });

  it('keeps secondary nutrients in a disclosure and opens it when one needs review', () => {
    const view = renderReview();
    expect(screen.getByRole('button', { name: 'More nutrients' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Sodium (mg)')).not.toBeInTheDocument();

    view.unmount();
    renderReview({ entry: { ...entry, nutritionLookup: { missing: ['sodium'] } } });
    expect(screen.getByRole('button', { name: 'More nutrients' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Sodium (mg)')).toBeVisible();
  });
});
