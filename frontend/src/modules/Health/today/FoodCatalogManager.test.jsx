import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));
import { FoodCatalogManager } from './FoodCatalogManager.jsx';

beforeEach(() => api.mockReset());
describe('future saved-food definitions', () => {
  it('edits a gram basis in one command without rewriting any logged entry', async () => {
    api.mockImplementation(async (path, body, method) => method === 'PUT' ? { entry: body } : {
      items: [{ id: 'oats', name: 'Oats', grams: 80, nutrients: { calories: 300, fiber: 8 } }],
    });
    const changed = vi.fn();
    render(<MantineProvider><FoodCatalogManager open onClose={() => {}} onChanged={changed} /></MantineProvider>);
    fireEvent.click(await screen.findByRole('button', { name: /Oats/ }));
    fireEvent.change(screen.getByLabelText('Food name'), { target: { value: 'My oats' } });
    fireEvent.change(screen.getByLabelText('Nutrition basis in grams'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    const writes = api.mock.calls.filter(([, , method]) => method);
    expect(writes).toEqual([['api/v1/health/nutrition/catalog/oats', { name: 'My oats', grams: 90, nutrients: { calories: 300, fiber: 8 } }, 'PUT']]);
  });
  it('keeps the draft and shows a failed write for retry', async () => {
    api.mockImplementation(async (path, body, method) => {
      if (method) throw new Error('Connection interrupted');
      return { items: [{ id: 'oats', name: 'Oats', grams: 80, nutrients: { calories: 300 } }] };
    });
    render(<MantineProvider><FoodCatalogManager open onClose={() => {}} onChanged={() => {}} /></MantineProvider>);
    fireEvent.click(await screen.findByRole('button', { name: /Oats/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted');
    expect(screen.getByLabelText('Food name')).toHaveValue('Oats');
  });
});
