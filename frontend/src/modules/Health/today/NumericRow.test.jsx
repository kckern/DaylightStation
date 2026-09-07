import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { EntryRow } from './EntryRow.jsx';
import { PortionContext, usePortionDraft } from './usePortionDraft.js';
const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));
const date = '2026-09-06';
const food = { uuid: 'a', name: 'Eggs', grams: 100, calories: 200, protein: 20, carbs: 15, fat: 5, version: 1, date };
function Fixture() {
  const preview = usePortionDraft({ items: [food], budget: { food: 200, remaining: 800 }, reload: vi.fn() }, date);
  return <MantineProvider><PortionContext.Provider value={preview.control}><EntryRow row={preview.items[0]} onTap={() => {}} />
    <output aria-label="Day calories">{preview.budget.food}</output></PortionContext.Provider></MantineProvider>;
}
it('offers every numeric target and previews a macro edit before a single save', async () => {
  api.mockReset().mockResolvedValue({ versions: { a: 2 }, data: { version: 2 } });
  render(<Fixture />);
  for (const field of ['portion', 'calories', 'density', 'protein', 'carbs', 'fat']) {
    expect(screen.getByRole('button', { name: new RegExp(`Adjust ${field} of Eggs`) })).toBeTruthy();
  }
  const protein = screen.getByRole('button', { name: /Adjust protein of Eggs/ });
  fireEvent.keyDown(protein, { key: 'ArrowRight' });
  expect(screen.getByLabelText('Day calories').textContent).toBe('204');
  expect(api).not.toHaveBeenCalled();
  fireEvent.keyDown(protein, { key: 'Enter' });
  await waitFor(() => expect(api).toHaveBeenCalledOnce());
  expect(api.mock.calls[0][1]).toMatchObject({ numericEdit: { field: 'protein', value: 21 } });
});
