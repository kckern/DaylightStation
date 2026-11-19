import React from 'react';
import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import ListsFolder from './ListsFolder.jsx';
import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';

vi.mock('../../../../frontend/src/lib/api.mjs', async original => ({ ...await original(), DaylightAPI: vi.fn() }));

const menus = '/admin/content/lists/menus';
const api = '/api/v1' + menus;
beforeEach(() => { DaylightAPI.mockReset(); });

function openFolder() {
  render(<MantineProvider env="test"><MemoryRouter initialEntries={[menus + '/first']}>
    <Link to={menus + '/second'}>Open another folder</Link>
    <Routes>
      <Route path={menus} element={<span>Collection</span>} />
      <Route path="/admin/content/lists/:type/:name" element={<ListsFolder />} />
      <Route path="/admin/content/agendas/:id" element={<span>Agenda</span>} />
    </Routes>
  </MemoryRouter></MantineProvider>);
}

it.each([false, true])('only navigates for a confirmed delete in the current folder (departed=%s)', async departed => {
  const deletion = Promise.withResolvers();
  DaylightAPI.mockImplementation((path, body, method) => method === 'DELETE'
    ? deletion.promise : Promise.resolve({ title: path.split('/').pop(), sections: [] }));
  openFolder();
  await screen.findByText('First');
  fireEvent.click(screen.getByTestId('list-menu-button'));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete Menu' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Menu' }));
  await waitFor(() => expect(DaylightAPI).toHaveBeenCalledWith(api + '/first', {}, 'DELETE'));
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
  await waitFor(() => expect(DaylightAPI).toHaveBeenCalledWith(api + '/first'));
  fireEvent.click(screen.getByText('Open another folder'));
  await screen.findByText('Second');
  await act(async () => alias.reject(Object.assign(Error('Moved'), {
    body: { code: 'resource_moved', adminUrl: '/admin/content/agendas/fhe' },
  })));
  expect(screen.getByText('Second')).toBeInTheDocument();
});
