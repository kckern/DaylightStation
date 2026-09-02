import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { AddCombobox } from './AddCombobox.jsx';

function r(ui) { return render(<MantineProvider>{ui}</MantineProvider>); }

const SUGGEST = { items: [
  { id: 'a', name: 'Chicken breast', favorite: true, nutrients: { calories: 231 } },
  { id: 'b', name: 'Chicken thigh', favorite: false, nutrients: { calories: 280 } },
] };

describe('AddCombobox', () => {
  beforeEach(() => { apiMock.mockReset(); });

  it('typing fetches suggestions; favorites are marked', async () => {
    apiMock.mockResolvedValue(SUGGEST);
    r(<AddCombobox bucketId="afternoon" onDone={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'chick' } });
    await waitFor(() => expect(screen.getByText('Chicken breast')).toBeTruthy());
    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('suggest?q=chick'));
    expect(screen.getByText('Chicken breast').closest('.health-suggest__item--fav')).toBeTruthy();
  });

  it('picking a suggestion quick-adds with the bucket and calls onDone', async () => {
    apiMock.mockImplementation(async (path, body) => {
      if (path.includes('suggest')) return SUGGEST;
      if (path.includes('quickadd')) return { uuid: 'row-1' };
      return {};
    });
    const onDone = vi.fn();
    r(<AddCombobox bucketId="afternoon" onDone={onDone} onCancel={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'chick' } });
    await waitFor(() => screen.getByText('Chicken breast'));
    fireEvent.click(screen.getByText('Chicken breast'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const quickaddCall = apiMock.mock.calls.find(([p]) => p.includes('quickadd'));
    expect(quickaddCall[1]).toMatchObject({ catalogEntryId: 'a' });
    const putCall = apiMock.mock.calls.find(([p]) => p.includes('nutrilist/row-1'));
    expect(putCall[1]).toMatchObject({ mealTime: 'afternoon' });
  });

  it('free sentence with no pick submits to the NL pipeline', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path.includes('suggest')) return { items: [] };
      if (path.includes('nutrition/input')) return {
        messages: [{ text: '2 eggs — 140 kcal', choices: [[{ text: '✅ Accept', callback_data: 'cb-1' }]] }],
      };
      return {};
    });
    r(<AddCombobox bucketId="morning" onDone={() => {}} onCancel={() => {}} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '2 eggs and toast' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/140 kcal/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /accept/i })).toBeTruthy();
  });
});
