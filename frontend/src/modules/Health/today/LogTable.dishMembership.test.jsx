import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, expect, it, vi } from 'vitest';
import { LogTable } from './LogTable.jsx';
const api = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: api }));
afterEach(() => { cleanup(); api.mockReset(); });

const rows = [
  { uuid: 'bowl', kind: 'group', name: 'Rice bowl', mealTime: 'afternoon', calories: 0, version: 3 },
  { uuid: 'beef', name: 'Beef', parentId: 'bowl', mealTime: 'afternoon', calories: 300, version: 1 },
  { uuid: 'rice', name: 'Rice', parentId: 'bowl', mealTime: 'afternoon', calories: 200, version: 1 },
  { uuid: 'kimchi', name: 'Kimchi', mealTime: 'afternoon', calories: 20, version: 2 },
  { uuid: 'poke', kind: 'group', name: 'Poke', mealTime: 'afternoon', calories: 0, version: 1 },
  { uuid: 'tuna', name: 'Tuna', parentId: 'poke', mealTime: 'afternoon', calories: 150, version: 1 },
];
const mount = (props = {}) => render(<MantineProvider><LogTable date="2026-09-24" byBucket={new Map([['afternoon', rows]])}
  onRowTap={() => {}} onMealChanged={() => {}} {...props}/></MantineProvider>);
const versions = { bowl: 3, beef: 1, rice: 1, kimchi: 2, poke: 1, tuna: 1 };

it('takes an ingredient out of its dish without deleting it', async () => {
  const onMealChanged = vi.fn(); api.mockResolvedValue({ committed: true, undoToken: 'undo-1' });
  mount({ onMealChanged });
  fireEvent.click(screen.getByRole('button', { name: 'Take Rice out of Rice bowl' }));
  await waitFor(() => expect(onMealChanged).toHaveBeenCalledWith(expect.objectContaining({ undoToken: 'undo-1' })));
  expect(api).toHaveBeenCalledWith('api/v1/health/nutrition/meal-command', expect.objectContaining({
    action: 'membership', date: '2026-09-24', bucket: 'afternoon', groupId: 'bowl', selectedIds: ['beef'], expectedVersions: versions,
  }), 'POST');
});

it('adds a loose food, or another dish’s ingredient, from the dish’s last line', async () => {
  api.mockResolvedValue({ committed: true });
  mount();
  const picker = screen.getByRole('combobox', { name: 'Add a food to Rice bowl' });
  const labels = [...picker.querySelectorAll('option')].map(option => option.textContent);
  expect(labels).toEqual(['Add food to Rice bowl…', 'Kimchi', 'Tuna (from Poke)']);
  fireEvent.change(picker, { target: { value: 'kimchi' } });
  await waitFor(() => expect(api).toHaveBeenCalledWith('api/v1/health/nutrition/meal-command',
    expect.objectContaining({ action: 'membership', groupId: 'bowl', selectedIds: ['beef', 'rice', 'kimchi'] }), 'POST'));
});

it('shows the failure on the dish it belongs to', async () => {
  api.mockRejectedValue(new Error('This meal changed. Reload before saving.'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Take Tuna out of Poke' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'This meal changed. Reload before saving.');
});

it('offers no dish edits outside a real meal', () => {
  render(<MantineProvider><LogTable date="2026-09-24" byBucket={new Map([[null, rows]])} onRowTap={() => {}}/></MantineProvider>);
  expect(screen.queryByRole('button', { name: /out of/ })).toBeNull();
  expect(screen.queryByRole('combobox', { name: /Add a food to/ })).toBeNull();
});
