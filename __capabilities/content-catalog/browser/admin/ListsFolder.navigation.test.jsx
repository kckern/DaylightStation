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

it('keeps the committed section and retries only its list read', async () => {
  const sections = [{ title: 'Existing', items: [] }];
  let reads = 0;
  const followup = Promise.withResolvers();
  const retry = Promise.withResolvers();
  const writes = [];
  DaylightAPI.mockImplementation(async (path, body, method) => {
    if (method === 'POST' && path === api + '/first/sections') {
      writes.push(body);
      sections.push({ ...body, items: [] });
      return { ok: true, sectionIndex: 1 };
    }
    if (path === api + '/first') {
      reads++;
      if (reads === 2) await followup.promise;
      if (reads === 3) await retry.promise;
      return { sections: [...sections] };
    }
    return {};
  });
  openFolder();
  await screen.findByText('Existing');
  const add = screen.getByRole('button', { name: 'Add Section' });
  fireEvent.click(add);
  await waitFor(() => expect(reads).toBe(2));
  expect(add).toBeDisabled();
  fireEvent.click(add);
  expect(writes).toHaveLength(1);
  await act(async () => followup.reject(new Error('List read failed')));
  const region = await screen.findByRole('region', { name: 'List contents' });
  await within(region).findByText('Change saved. Could not refresh the list.');
  fireEvent.click(within(region).getByRole('button', { name: 'Retry' }));
  expect(region).toHaveFocus();
  expect(region).toHaveAttribute('aria-busy', 'true');
  await act(async () => retry.resolve());
  expect(region).toHaveFocus();
  expect(within(region).getByText('Section 2')).toBeInTheDocument();
  expect(within(region).queryByRole('alert')).toBeNull();
  expect(writes).toEqual([{ title: 'Section 2' }]);
  expect(reads).toBe(3);
});

it('leaves a refused section add available for correction without refreshing the list', async () => {
  DaylightAPI.mockImplementation(async (path, body, method) => {
    if (method === 'POST') throw new Error('Section title rejected');
    return { sections: [{ title: 'Existing', items: [] }] };
  });
  openFolder();
  await screen.findByText('Existing');
  const add = screen.getByRole('button', { name: 'Add Section' });
  fireEvent.click(add);
  await screen.findByText('Section title rejected');
  expect(add).toBeEnabled();
  expect(screen.queryByText(/Change saved/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(DaylightAPI.mock.calls.map(([, , method]) => method)).toEqual(['GET', 'POST']);
});

it('moves to the newly created section index before refreshing the compound change', async () => {
  const summary = [];
  DaylightAPI.mockImplementation(async (path, body, method) => {
    if (path === api + '/first') {
      summary.push(method);
      return { sections: [{ title: 'Existing', items: [{ uid: 'a', label: 'First item' }] }] };
    }
    if (path.endsWith('/sections')) {
      summary.push([method, body]);
      return { ok: true, sectionIndex: 3 };
    }
    if (path.endsWith('/items/move')) summary.push([method, body]);
    return {};
  });
  openFolder();
  const row = await screen.findByTestId('item-row-0-0');
  fireEvent.contextMenu(row.querySelector('.drag-handle'));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'New Section' }));
  await waitFor(() => expect(summary).toEqual([
    'GET',
    ['POST', { title: 'Section 2' }],
    ['PUT', { from: { section: 0, index: 0 }, to: { section: 3, index: 0 } }],
    'GET',
  ]));
});
