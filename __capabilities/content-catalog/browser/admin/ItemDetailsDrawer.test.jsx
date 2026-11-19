import { it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import ItemDetailsDrawer from './ItemDetailsDrawer.jsx';

afterEach(() => vi.unstubAllGlobals());

it('keeps the selected item when an earlier parent request finishes and resets breadcrumbs', async () => {
  let resolveParent;
  const fetch = vi.fn(async url => {
    if (url.endsWith('/parent')) return new Promise(resolve => { resolveParent = resolve; });
    const title = url.endsWith('/chapter%2F2') ? 'Second chapter' : 'First chapter';
    return Response.json({ id: title, source: 'plex', title, metadata: { parentRatingKey: 'parent', parentTitle: 'Book' } });
  });
  vi.stubGlobal('fetch', fetch);
  const drawer = id => <MantineProvider><ItemDetailsDrawer opened onClose={() => {}} contentValue={id} /></MantineProvider>;
  const tree = render(drawer('plex:1'));
  fireEvent.click(await screen.findByRole('button', { name: 'Book' }));
  tree.rerender(drawer('plex: chapter/2'));
  await screen.findByText('Second chapter');
  await act(async () => { resolveParent(Response.json({ title: 'Late book', id: 'parent' })); });
  expect(screen.queryByText('Late book')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Back to original' })).toBeNull();
  expect(screen.getByText('Second chapter')).toBeInTheDocument();
});

it('keeps the route back to the selected item when its parent cannot load', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => url.endsWith('/missing')
    ? new Response(null, { status: 404 })
    : Response.json({ source: 'plex', id: 'original', title: 'Chapter', metadata: { parentRatingKey: 'missing', parentTitle: 'Missing book' } })));
  render(<MantineProvider><ItemDetailsDrawer opened contentValue="plex:original" /></MantineProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Missing book' }));
  await screen.findByRole('button', { name: 'Retry' });
  fireEvent.click(screen.getByRole('button', { name: 'Back to original' }));
  await screen.findByText('Chapter');
});
