import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));
const show = vi.fn();
vi.mock('../healthResources.js', () => ({ showDayStatus: (...args) => show(...args) }));

import { MealFastToggle } from './MealFastToggle.jsx';

const mount = (props) => render(<MantineProvider><MealFastToggle date="2026-09-24" bucket="morning" label="Breakfast" {...props} /></MantineProvider>);

beforeEach(() => { api.mockReset(); show.mockReset(); });

describe('MealFastToggle', () => {
  it('marks an empty meal as skipped, patches the day with the server answer, and reports the change', async () => {
    const result = { status: null, fastedMeals: ['morning'] };
    api.mockResolvedValue(result);
    const onChanged = vi.fn();
    mount({ fasted: false, onChanged });
    fireEvent.click(screen.getByRole('button', { name: /Skipped Breakfast/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('api/v1/health/nutrition/meal-fast', { date: '2026-09-24', meal: 'morning', fasted: true }, 'POST'));
    expect(show).toHaveBeenCalledWith('2026-09-24', result);
    expect(onChanged).toHaveBeenCalled();
  });

  it('offers the undo when the meal is already fasted', async () => {
    api.mockResolvedValue({ status: null, fastedMeals: [] });
    mount({ fasted: true });
    const button = screen.getByRole('button', { name: /Undo skipped Breakfast/ });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    await waitFor(() => expect(api).toHaveBeenCalledWith('api/v1/health/nutrition/meal-fast', { date: '2026-09-24', meal: 'morning', fasted: false }, 'POST'));
  });

  it('says so when the save fails', async () => {
    api.mockRejectedValue(new Error('offline'));
    mount({ fasted: false });
    fireEvent.click(screen.getByRole('button', { name: /Skipped Breakfast/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not save/);
  });
});
