import React from 'react';
import { MantineProvider } from '@mantine/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import ListsFolder from './ListsFolder.jsx';

const fixture = vi.hoisted(() => ({ api: vi.fn(), dragEnd: null }));
vi.mock('../../../../frontend/src/lib/api.mjs', async original => ({
  ...await original(), DaylightAPI: fixture.api,
}));
vi.mock('@dnd-kit/core', async original => ({
  ...await original(),
  DndContext: ({ children, onDragEnd }) => { fixture.dragEnd = onDragEnd; return children; },
  DragOverlay: () => null,
}));

let finishSwap;
beforeEach(() => {
  fixture.api.mockReset().mockImplementation(async (path, body, method) => {
    if (method === 'PUT' && path.endsWith('/items/swap')) {
      return new Promise(resolve => { finishSwap = resolve; });
    }
    if (path.includes('/lists/menus/')) {
      const name = path.split('/').pop();
      return { sections: [{ title: 'Rows', items: [0, 1, 2].map(i => ({
        uid: String(i), label: name + ' row ' + i, title: name + ' row ' + i, action: 'Play',
      })) }] };
    }
    return {};
  });
});

async function openFolder() {
  render(<MantineProvider><MemoryRouter initialEntries={['/lists/menus/first']}>
    <Link to="/lists/menus/second">Second folder</Link>
    <Routes><Route path="/lists/:type/:name" element={<ListsFolder />} /></Routes>
  </MemoryRouter></MantineProvider>);
  await screen.findByTestId('item-row-0-2');
}
function startSwap() {
  let result;
  act(() => { result = fixture.dragEnd({ active: { id: 'content-0-0' }, over: { id: 'content-0-1' } }); });
  return result;
}
function flashed() {
  return screen.getAllByTestId(/^item-row-/).filter(row => row.querySelector('.swap-flash'));
}

it('confirms only the two swapped rows and restarts their decoration without replacing the row', async () => {
  await openFolder();
  const first = screen.getByTestId('item-row-0-0');
  const second = screen.getByTestId('item-row-0-1');
  async function confirm() {
    const result = startSwap();
    await act(async () => { finishSwap({}); await result; });
  }
  await confirm();
  expect(fixture.api).toHaveBeenCalledWith('/api/v1/admin/content/lists/menus/first/items/swap',
    { a: { section: 0, index: 0 }, b: { section: 0, index: 1 } }, 'PUT');
  expect(flashed()).toEqual([first, second]);
  const decoration = first.querySelector('.swap-flash');
  await confirm();
  expect(flashed()).toEqual([first, second]);
  expect(first.querySelector('.swap-flash')).not.toBe(decoration);
});

it('keeps a replacement folder intact when the previous folder swap finishes', async () => {
  await openFolder();
  const pending = startSwap();
  act(() => screen.getByRole('link', { name: 'Second folder' }).click());
  await waitFor(() => expect(screen.getByTestId('item-row-0-0')).toHaveTextContent('second row 0'));
  await act(async () => { finishSwap({}); await pending; });
  expect(screen.getByTestId('item-row-0-0')).toHaveTextContent('second row 0');
  expect(flashed()).toEqual([]);
});
