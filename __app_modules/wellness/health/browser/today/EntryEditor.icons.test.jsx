import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EntryEditor } from './EntryEditor.jsx';
import { refreshHealthResources } from '../healthResources.js';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: request,
  DaylightMediaPath: path => path,
}));

const row = { uuid: 'food', name: 'Tea', mealTime: 'morning', date: '2026-11-18', grams: 100 };
const iconPath = query => `api/v1/health/nutrition/icons?q=${encodeURIComponent(query)}&limit=60`;
const iconCalls = () => request.mock.calls.map(([path]) => path).filter(path => path.includes('/nutrition/icons?'));
const openEditor = () => render(<MantineProvider>
  <EntryEditor open row={row} onClose={() => {}} onChanged={() => {}} />
</MantineProvider>);
const togglePicker = () => fireEvent.click(screen.getByRole('button', { name: 'Change food icon' }));
const choose = name => screen.queryByRole('button', { name, exact: true });

beforeEach(() => { request.mockReset(); });

it('loads default icons on open and ignores replies for an older query', async () => {
  const pending = new Map();
  request.mockImplementation(path => {
    if (path === iconPath('')) return Promise.resolve({ icons: ['apple'] });
    if (path.includes('/nutrition/icons?')) {
      return new Promise(resolve => pending.set(new URL(path, 'https://fixture.test').searchParams.get('q'), resolve));
    }
    return Promise.resolve({ items: [] });
  });
  openEditor();
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect(iconCalls()).toEqual([]);
  togglePicker();
  expect(await screen.findByRole('button', { name: 'apple', exact: true })).toBeVisible();
  expect(iconCalls()).toEqual([iconPath('')]);

  const search = screen.getByRole('textbox', { name: 'Search icons' });
  fireEvent.change(search, { target: { value: 'tea' } });
  expect(choose('apple')).toBeNull();
  fireEvent.change(search, { target: { value: 'green tea' } });
  expect(pending.has('tea')).toBe(true);
  expect(pending.has('green tea')).toBe(true);
  await act(async () => pending.get('green tea')({ icons: ['green-tea'] }));
  await act(async () => pending.get('tea')({ icons: ['stale-tea'] }));
  expect(choose('green-tea')).toBeVisible();
  expect(choose('stale-tea')).toBeNull();
  expect(iconCalls()).toEqual([iconPath(''), iconPath('tea'), iconPath('green tea')]);
});

it('retries only the current icon search and preserves the editable draft', async () => {
  let citrusReads = 0;
  request.mockImplementation(path => {
    if (path === iconPath('citrus')) {
      if (++citrusReads === 1) return Promise.reject(new Error('Icon service unavailable'));
      return Promise.resolve({ icons: ['orange'] });
    }
    return Promise.resolve({ icons: [], items: [] });
  });
  openEditor();
  fireEvent.change(screen.getByRole('textbox', { name: 'Name', exact: true }), { target: { value: 'Unsaved tea' } });
  togglePicker();
  const search = screen.getByRole('textbox', { name: 'Search icons' });
  fireEvent.change(search, { target: { value: 'citrus' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Food icons failed to load');
  fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
  expect(await screen.findByRole('button', { name: 'orange', exact: true })).toBeVisible();
  expect(iconCalls().filter(path => path === iconPath('citrus'))).toHaveLength(2);
  expect(screen.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Unsaved tea');

  search.focus();
  await act(async () => { refreshHealthResources(); });
  expect(document.activeElement).toBe(search);
  expect(choose('orange')).toBeVisible();
  expect(citrusReads).toBe(2);
});
