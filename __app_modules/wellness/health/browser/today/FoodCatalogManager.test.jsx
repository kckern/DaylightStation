import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
const api = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...args) => api(...args) }));
import { FoodCatalogManager } from "./FoodCatalogManager.jsx";
import { resetApiResourceCache } from "../../../../../frontend/src/lib/hooks/useApiResource.js";

beforeEach(() => {
  api.mockReset();
  resetApiResourceCache();
});

describe('future saved-food definitions', () => {
  it('retries the current saved-food query and ignores an older result', async () => {
    const first = Promise.withResolvers();
    const initialPath = 'api/v1/health/nutrition/catalog/suggest?q=&limit=40';
    const searchPath = 'api/v1/health/nutrition/catalog/suggest?q=rolled%20oats&limit=40';
    let searchReads = 0;
    api.mockImplementation(async path => {
      if (path === initialPath) return first.promise;
      if (path !== searchPath) throw new Error(`Unexpected request: ${path}`);
      if (++searchReads === 1) throw new Error('Saved foods temporarily unavailable');
      return { items: [{ id: 'oats', name: 'Rolled oats', grams: 80 }] };
    });
    render(<MantineProvider><FoodCatalogManager open onClose={() => {}} onChanged={() => {}} /></MantineProvider>);
    await waitFor(() => expect(api).toHaveBeenCalledWith(initialPath));
    const query = screen.getByLabelText('Find a saved food');
    fireEvent.change(query, { target: { value: 'rolled oats' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved foods temporarily unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /Rolled oats/ })).toBeVisible();
    await act(async () => first.resolve({ items: [{ id: 'apple', name: 'Apple', grams: 50 }] }));
    expect(screen.queryByRole('button', { name: /Apple/ })).toBeNull();
    expect(query).toHaveValue('rolled oats');
    expect(api.mock.calls).toEqual([[initialPath], [searchPath], [searchPath]]);
  });

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
