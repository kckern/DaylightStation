import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { clearCache } from '../lib/siblingsCache.js';
import { ContentCombobox } from './ContentCombobox.jsx';

vi.mock('../../../../frontend/src/lib/logging/singleton.js', () => {
  const logger = { debug() {}, info() {}, warn() {}, error() {}, sampled() {} };
  return { getChildLogger: () => logger };
});

it('scrolls for more siblings in the new picker window while the old page is pending', async () => {
  const firstPath = '/api/v1/siblings/plex/10';
  const secondPath = '/api/v1/siblings/plex/20';
  const pagination = { offset: 40, window: 1, total: 100, hasBefore: false, hasAfter: true };
  const requests = [];
  const response = body => ({ ok: true, status: 200, json: async () => body });
  let finishOldPage;
  let finishNewPage;
  const oldPage = new Promise(resolve => { finishOldPage = resolve; });
  const newPage = new Promise(resolve => { finishNewPage = resolve; });
  clearCache();
  vi.stubGlobal('fetch', vi.fn(async url => {
    const { pathname, search } = new URL(url, window.location.origin);
    if (pathname !== firstPath && pathname !== secondPath) return response({});
    const id = 'plex:' + pathname.split('/').at(-1);
    requests.push(pathname + search);
    if (!search) return response({ items: [{ id, title: id }], referenceIndex: 0, pagination });
    return pathname === firstPath ? oldPage : newPage;
  }));

  const picker = value => <MantineProvider><ContentCombobox value={value} onChange={() => {}} /></MantineProvider>;
  const view = render(picker('plex:10'));
  const scrollToEnd = async id => {
    const option = await screen.findByTestId('combobox-option-' + id);
    const viewport = option.closest('.mantine-ScrollArea-viewport');
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 300 },
    });
    viewport.scrollTop = 300;
    fireEvent.scroll(viewport);
  };
  try {
    fireEvent.click(screen.getByRole('textbox'));
    await scrollToEnd('plex:10');
    expect(requests).toContain(firstPath + '?offset=41&limit=21');
    view.rerender(picker('plex:20'));
    fireEvent.click(screen.getByRole('textbox'));
    await scrollToEnd('plex:20');

    expect(requests).toContain(secondPath + '?offset=41&limit=21');
    await act(async () => { finishOldPage(response({ items: [{ id: 'plex:11', title: 'Old page' }] })); });
    expect(screen.getByRole('status', { name: 'Loading more items' })).toBeVisible();
    expect(screen.queryByText('Old page')).toBeNull();
    await act(async () => { finishNewPage(response({ items: [{ id: 'plex:21', title: 'New page' }] })); });
    expect(await screen.findByText('New page')).toBeVisible();
  } finally {
    await act(async () => {
      finishOldPage(response({ items: [] }));
      finishNewPage(response({ items: [] }));
    });
    vi.unstubAllGlobals();
  }
});
