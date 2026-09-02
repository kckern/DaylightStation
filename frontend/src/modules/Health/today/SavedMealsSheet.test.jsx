import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { DismissStackProvider } from '@/lib/ui';
import { SavedMealsSheet } from './SavedMealsSheet.jsx';

function r(ui) {
  return render(<MantineProvider><DismissStackProvider>{ui}</DismissStackProvider></MantineProvider>);
}

const MEALS = { meals: [
  { id: 'm1', name: 'Protein breakfast', items: [{ name: 'Eggs', calories: 140 }, { name: 'Toast', calories: 180 }] },
] };

describe('SavedMealsSheet', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (path) => (path.endsWith('nutrition/meals') ? MEALS : { items: [] }));
  });

  it('lists saved meals with item count and kcal', async () => {
    r(<SavedMealsSheet open onClose={() => {}} onLogged={() => {}} bucketId="morning" />);
    await waitFor(() => expect(screen.getByText('Protein breakfast')).toBeTruthy());
    expect(screen.getByText(/2 items · 320 kcal/)).toBeTruthy();
  });

  it('tapping a meal logs it to the bucket', async () => {
    const onLogged = vi.fn();
    r(<SavedMealsSheet open onClose={() => {}} onLogged={onLogged} bucketId="morning" />);
    await waitFor(() => screen.getByText('Protein breakfast'));
    fireEvent.click(screen.getByText('Protein breakfast'));
    await waitFor(() => expect(onLogged).toHaveBeenCalled());
    const logCall = apiMock.mock.calls.find(([p]) => p.includes('/m1/log'));
    expect(logCall[1]).toMatchObject({ mealTime: 'morning' });
  });
});
