import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';
import { resetApiResourceCache } from '../../../../frontend/src/lib/hooks/useApiResource.js';
import ListsIndex from './ListsIndex.jsx';

vi.mock('../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

const menus = '/api/v1/admin/content/lists/menus';
const watchlists = '/api/v1/admin/content/lists/watchlists';
const collection = name => ({ lists: [{ name, active: true }] });

function openMenus() {
  render(
    <MantineProvider env="test">
      <MemoryRouter initialEntries={['/admin/content/lists/menus']}>
        <Link to="/admin/content/lists/menus">Browse menus</Link>
        <Link to="/admin/content/lists/watchlists">Browse watchlists</Link>
        <Routes><Route path="/admin/content/lists/:type" element={<ListsIndex />} /></Routes>
      </MemoryRouter>
    </MantineProvider>
  );
}

async function enterName(name) {
  fireEvent.click(await screen.findByTestId('new-list-button'));
  fireEvent.change(await screen.findByTestId('list-name-input'), { target: { value: name } });
}

beforeEach(() => {
  DaylightAPI.mockReset();
  resetApiResourceCache();
});

it('keeps watchlist cards when a departed menus read settles', async () => {
  const pending = Promise.withResolvers();
  DaylightAPI.mockImplementation(path => path === menus ? pending.promise : Promise.resolve(collection('watchlist')));
  openMenus();
  await waitFor(() => expect(DaylightAPI).toHaveBeenCalledWith(menus));
  fireEvent.click(screen.getByText('Browse watchlists'));
  await screen.findByTestId('list-card-watchlist');
  await act(async () => pending.resolve(collection('menu')));
  expect(screen.queryByTestId('list-card-menu')).not.toBeInTheDocument();
  expect(screen.getByTestId('list-card-watchlist')).toHaveAttribute('href', '/admin/content/lists/watchlists/watchlist');
});

it('closes a committed create and retries a failed refresh with just a GET', async () => {
  DaylightAPI.mockResolvedValueOnce(collection('existing'))
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(Error('Menus unavailable'))
    .mockResolvedValueOnce(collection('new-menu'));
  openMenus();
  await enterName('new-menu');
  fireEvent.click(screen.getByTestId('create-list-submit'));
  await screen.findByText('Menus unavailable');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByTestId('list-card-new-menu');
  expect(DaylightAPI.mock.calls).toEqual([[menus], [menus, { name: 'new-menu' }, 'POST'], [menus], [menus]]);
});

it('leaves the new route draft intact when a departed create settles', async () => {
  const pending = Promise.withResolvers();
  DaylightAPI.mockImplementation((path, body, method) => method === 'POST'
    ? pending.promise : Promise.resolve(collection(path === menus ? 'menu' : 'watchlist')));
  openMenus();
  await enterName('old draft');
  fireEvent.click(screen.getByTestId('create-list-submit'));
  fireEvent.click(screen.getByText('Browse watchlists'));
  await screen.findByTestId('list-card-watchlist');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await enterName('new draft');
  await act(async () => pending.resolve({ list: 'old draft' }));
  expect(screen.getByTestId('list-name-input')).toHaveValue('new draft');
  expect(DaylightAPI.mock.calls).toEqual([[menus], [menus, { name: 'old draft' }, 'POST'], [watchlists]]);
});

it('revalidates the current menus reader when an earlier menus visit commits', async () => {
  const pending = Promise.withResolvers();
  let committed = false;
  DaylightAPI.mockImplementation((path, body, method) => {
    if (method === 'POST') return pending.promise;
    return Promise.resolve(collection(path === watchlists ? 'watchlist' : committed ? 'created-menu' : 'original-menu'));
  });
  openMenus();
  await enterName('created-menu');
  fireEvent.click(screen.getByTestId('create-list-submit'));
  fireEvent.click(screen.getByText('Browse watchlists'));
  await screen.findByTestId('list-card-watchlist');
  fireEvent.click(screen.getByText('Browse menus'));
  await screen.findByTestId('list-card-original-menu');
  await enterName('another draft');
  committed = true;
  await act(async () => pending.resolve({ list: 'created-menu' }));
  await screen.findByTestId('list-card-created-menu');
  expect(screen.getByTestId('list-name-input')).toHaveValue('another draft');
});

it('keeps a rejected name editable in its create dialog', async () => {
  DaylightAPI.mockResolvedValueOnce(collection('existing'))
    .mockRejectedValueOnce(Error('Name already taken'));
  openMenus();
  await enterName('existing');
  fireEvent.click(screen.getByTestId('create-list-submit'));
  await screen.findByText('Name already taken');
  expect(screen.getByTestId('list-name-input')).toHaveValue('existing');
  expect(screen.getByTestId('create-list-submit')).toBeEnabled();
  expect(DaylightAPI.mock.calls).toEqual([[menus], [menus, { name: 'existing' }, 'POST']]);
});
