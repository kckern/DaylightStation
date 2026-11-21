import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import GamesIndex from './GamesIndex.jsx';

function renderGames(fetch) {
  vi.stubGlobal('fetch', fetch);
  return render(<MemoryRouter><MantineProvider><GamesIndex /></MantineProvider></MemoryRouter>);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('releases the initial loader at five seconds and keeps the successful console list', async () => {
  vi.useFakeTimers();
  let scheduleSignal;
  let attempts = 0;
  renderGames((url, { signal }) => {
    if (url.includes('/content/schedule/')) {
      attempts++;
      if (attempts > 1) return Promise.resolve(Response.json({ schedule: null }));
      scheduleSignal = signal;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    }
    return Promise.resolve(Response.json(url.includes('/list/') ? [{ id: 'retroarch:gb', title: 'Game Boy' }] : {}));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
  expect(screen.queryByRole('link', { name: /Game Boy/ })).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(scheduleSignal.aborted).toBe(true);
  expect(screen.queryByRole('button', { name: /Game Schedule/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await act(async () => {});
  expect(screen.getByRole('button', { name: /Game Schedule/ })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Game Boy/ })).toHaveAttribute('href', '/admin/content/games/gb');
});

it('refreshes after one sync, retains the schedule draft and retries a refused save against fresh config', async () => {
  let syncs = 0;
  let scheduleReads = 0;
  let configReads = 0;
  const writes = [];
  const { container } = renderGames(async (url, { method, body }) => {
    const { pathname } = new URL(url);
    if (pathname.includes('/admin/config/files/')) {
      if (method === 'GET') {
        configReads++;
        return Response.json(configReads === 1 ? { parsed: null } : { parsed: { launch: { generation: configReads } } });
      }
      writes.push(JSON.parse(body).parsed);
      return Response.json({ ok: writes.length > 1 });
    }
    if (pathname.endsWith('/sync/retroarch')) {
      expect(method).toBe('POST');
      syncs++;
      return Response.json({ ok: true });
    }
    if (pathname.endsWith('/status')) return Response.json({ itemCount: syncs + 1 });
    if (pathname.includes('/content/schedule/')) {
      scheduleReads++;
      return Response.json({ schedule: {} });
    }
    return Response.json({ items: [{ id: 'retroarch:gb', title: syncs ? 'Updated console' : 'Game Boy' }] });
  });

  await screen.findByRole('link', { name: /Game Boy/ });
  fireEvent.click(screen.getByRole('button', { name: /Game Schedule/ }));
  fireEvent.mouseDown(container.querySelector('.schedule-grid__cell'));
  fireEvent.mouseUp(container.querySelector('.schedule-grid'));
  fireEvent.click(screen.getByRole('button', { name: 'Sync from Device' }));
  await screen.findByRole('link', { name: /Updated console/ });
  expect(screen.getByText(/2 games · Last synced/)).toBeVisible();
  expect(syncs).toBe(1);
  expect(scheduleReads).toBe(1);
  const save = screen.getByRole('button', { name: 'Save Schedule' });

  fireEvent.click(save);
  await screen.findByText('Could not read the current games configuration.');
  expect(writes).toHaveLength(0);
  fireEvent.click(save);
  await screen.findByText('The server did not confirm the schedule save.');
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await waitFor(() => expect(save).not.toBeInTheDocument());
  expect(writes).toEqual([2, 3].map(generation => ({
    launch: { generation }, schedule: { monday: [{ start: '06:00', end: '06:30' }] },
  })));
});

it('shows the new sync count and retains the prior console list when its refresh fails', async () => {
  let synced = false;
  renderGames(async (url, options) => {
    if (options.method === 'POST') { synced = true; return Response.json({ ok: true }); }
    if (url.endsWith('/status')) return Response.json({ itemCount: synced ? 12 : 1 });
    if (url.includes('/list/')) return synced
      ? new Response('', { status: 404 })
      : Response.json([{ id: 'retroarch:gb', title: 'Game Boy' }]);
    return Response.json({ schedule: null });
  });
  await screen.findByRole('link', { name: /Game Boy/ });
  fireEvent.click(screen.getByRole('button', { name: 'Sync from Device' }));
  await screen.findByRole('alert');
  expect(screen.getByText(/12 games · Last synced/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Game Boy/ })).toBeInTheDocument();
});
