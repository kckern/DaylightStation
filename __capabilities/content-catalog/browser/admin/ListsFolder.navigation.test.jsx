import React from 'react';
import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import ListsIndex from './ListsIndex.jsx';
import ListsFolder from './ListsFolder.jsx';
import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';

vi.mock('../../../../frontend/src/lib/api.mjs', async original => ({ ...await original(), DaylightAPI: vi.fn() }));

const menus = '/admin/content/lists/menus';
const api = '/api/v1' + menus;
beforeEach(() => { DaylightAPI.mockReset(); });

function openFolder({ showIndex = false } = {}) {
  render(<MantineProvider env="test"><MemoryRouter initialEntries={[menus + '/first']}>
    <Link to={menus + '/second'}>Open another folder</Link>
    <Link to={menus}>Browse menus</Link>
    <Link to="/admin/content/lists/watchlists">Browse watchlists</Link>
    <Routes>
      <Route path="/admin/content/lists/:type" element={showIndex ? <ListsIndex /> : <span>Collection</span>} />
      <Route path="/admin/content/lists/:type/:name" element={<ListsFolder />} />
      <Route path="/admin/content/agendas/:id" element={<span>Agenda</span>} />
    </Routes>
  </MemoryRouter></MantineProvider>);
}

async function confirmDelete() {
  await screen.findByText('First');
  fireEvent.click(screen.getByTestId('list-menu-button'));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete Menu' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Menu' }));
  await waitFor(() => expect(DaylightAPI).toHaveBeenCalledWith(api + '/first', {}, 'DELETE'));
}

it.each([false, true])('only navigates for a confirmed delete in the current folder (departed=%s)', async departed => {
  const deletion = Promise.withResolvers();
  DaylightAPI.mockImplementation((path, body, method) => method === 'DELETE'
    ? deletion.promise : Promise.resolve({ title: path.split('/').pop(), sections: [] }));
  openFolder();
  await confirmDelete();
  if (departed) {
    fireEvent.click(screen.getByText('Open another folder'));
    await screen.findByText('Second');
  }
  await act(async () => deletion.resolve({}));
  expect(screen.getByText(departed ? 'Second' : 'Collection')).toBeInTheDocument();
  expect(DaylightAPI.mock.calls.filter(([path]) => path === api)).toEqual([]);
});

it('ignores a moved alias response after another folder has opened', async () => {
  const alias = Promise.withResolvers();
  DaylightAPI.mockImplementation(path => path.endsWith('/first') ? alias.promise : Promise.resolve({ title: 'second', sections: [] }));
  openFolder();
  await waitFor(() => expect(DaylightAPI).toHaveBeenCalledWith(
    api + '/first', {}, 'GET', { signal: expect.any(AbortSignal) },
  ));
  const [, , , { signal }] = DaylightAPI.mock.calls.find(([path]) => path === api + '/first');
  fireEvent.click(screen.getByText('Open another folder'));
  await screen.findByText('Second');
  expect(signal.aborted).toBe(true);
  await act(async () => alias.reject(Object.assign(Error('Moved'), {
    body: { code: 'resource_moved', adminUrl: '/admin/content/agendas/fhe' },
  })));
  expect(screen.getByText('Second')).toBeInTheDocument();
});

it.each(['menus', 'watchlists'])('refreshes only the deleted collection when %s is open at commit', async type => {
  const deletion = Promise.withResolvers();
  const collection = '/api/v1/admin/content/lists/' + type;
  let committed = false;
  DaylightAPI.mockImplementation((path, body, method) => {
    if (method === 'DELETE') return deletion.promise;
    if (path === collection) return Promise.resolve({ lists: [{ name: committed ? 'updated' : 'original' }] });
    return Promise.resolve({ title: 'first', sections: [] });
  });
  openFolder({ showIndex: true });
  await confirmDelete();
  fireEvent.click(screen.getByText('Browse ' + type));
  await screen.findByTestId('list-card-original');
  committed = true;
  await act(async () => deletion.resolve({}));
  expect(screen.getByTestId(type === 'menus' ? 'list-card-updated' : 'list-card-original')).toBeInTheDocument();
  expect(DaylightAPI.mock.calls.filter(([path]) => path === collection)).toHaveLength(type === 'menus' ? 2 : 1);
});
