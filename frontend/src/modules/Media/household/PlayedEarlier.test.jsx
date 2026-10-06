// FIND.11a — Played earlier: newest first, picture, title, time played, full verbs.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));
const dispatch = vi.fn(); const dispatchLeafVerb = vi.fn();
vi.mock('../search/useContentDispatch.js', () => ({
  useContentDispatch: () => ({ dispatch, dispatchLeafVerb, playContainerAsQueue: vi.fn(), addContainerToQueue: vi.fn() }),
}));
vi.mock('../shell/NavProvider.jsx', () => ({ useNav: () => ({ push: vi.fn() }) }));
vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import { PlayedEarlier } from './PlayedEarlier.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

const rows = [
  { contentId: 'plex:2', startedAt: new Date(Date.now() - 60_000).toISOString(), title: 'Song B', thumbnail: '/b.jpg', type: 'track', grandparentTitle: 'Artist' },
  { contentId: 'plex:1', startedAt: new Date(Date.now() - 3_600_000).toISOString(), title: 'Song A', thumbnail: null, type: 'track' },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetApiResourceCache();
  apiMock.mockImplementation((path, body, method) => {
    if (method && method !== 'GET') return Promise.resolve({ ok: true });
    if (path.startsWith('api/v1/media/screens/livingroom-tv/played-earlier')) return Promise.resolve({ deviceId: 'fleet:livingroom-tv', items: rows });
    if (path === 'api/v1/media/household/favourites') return Promise.resolve({ items: [] });
    if (path === 'api/v1/media/screens') return Promise.resolve({ screens: [] });
    return Promise.reject(new Error(path));
  });
});

describe('PlayedEarlier', () => {
  it('lists the screen plays newest first with picture, title and time played', async () => {
    render(<MantineProvider><PlayedEarlier screenId="livingroom-tv" /></MantineProvider>);
    const first = await screen.findByTestId('played-earlier-0');
    expect(apiMock.mock.calls.map(c => c[0])).toContain('api/v1/media/screens/livingroom-tv/played-earlier?limit=20');
    expect(first).toHaveTextContent('Song B');
    expect(within(first).getByTestId('played-earlier-0-when')).toHaveTextContent(/Artist · Today/);
    expect(first.querySelector('img')).toHaveAttribute('src', '/b.jpg');
    expect(screen.getByTestId('played-earlier-1')).toHaveTextContent('Song A');
  });

  it('a row plays at the aim and offers favourites in its menu', async () => {
    render(<MantineProvider><PlayedEarlier screenId="livingroom-tv" /></MantineProvider>);
    fireEvent.click(await screen.findByTestId('played-earlier-0-play'));
    expect(dispatchLeafVerb).toHaveBeenCalledWith('playNow', 'plex:2', expect.objectContaining({ id: 'plex:2' }));
    fireEvent.click(screen.getByTestId('played-earlier-0-more'));
    fireEvent.click(await screen.findByTestId('played-earlier-0-verb-favourite'));
    expect(apiMock).toHaveBeenCalledWith('api/v1/media/household/favourites', expect.objectContaining({ id: 'plex:2', kind: 'item' }), 'POST');
  });
});

describe('PlayedEarlier refresh (review)', () => {
  it('does not refetch on every track change; at most once a minute', async () => {
    const calls = () => apiMock.mock.calls.filter(c => String(c[0]).includes('/played-earlier')).length;
    const base = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(base);
    try {
      const { rerender } = render(<MantineProvider><PlayedEarlier screenId="livingroom-tv" currentContentId="plex:a" /></MantineProvider>);
      await screen.findByTestId('played-earlier-0');
      expect(calls()).toBe(1);
      for (const id of ['plex:b', 'plex:c', 'plex:d']) {
        rerender(<MantineProvider><PlayedEarlier screenId="livingroom-tv" currentContentId={id} /></MantineProvider>);
      }
      await new Promise(r => setTimeout(r, 50));
      expect(calls()).toBe(1);
      nowSpy.mockReturnValue(base + 61_000);
      rerender(<MantineProvider><PlayedEarlier screenId="livingroom-tv" currentContentId="plex:e" /></MantineProvider>);
      await waitFor(() => expect(calls()).toBe(2));
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('a change inside the throttle window is refreshed once the window ends, not dropped', async () => {
    const calls = () => apiMock.mock.calls.filter(c => String(c[0]).includes('/played-earlier')).length;
    const base = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(base);
    try {
      const { rerender } = render(<MantineProvider><PlayedEarlier screenId="livingroom-tv" currentContentId="plex:a" /></MantineProvider>);
      await screen.findByTestId('played-earlier-0');
      expect(calls()).toBe(1);
      nowSpy.mockReturnValue(base + 30_000);
      vi.useFakeTimers({ shouldAdvanceTime: true });
      rerender(<MantineProvider><PlayedEarlier screenId="livingroom-tv" currentContentId="plex:b" /></MantineProvider>);
      expect(calls()).toBe(1);
      await act(async () => { vi.advanceTimersByTime(29_000); });
      expect(calls()).toBe(1);
      nowSpy.mockReturnValue(base + 60_000);
      await act(async () => { vi.advanceTimersByTime(1_500); });
      await waitFor(() => expect(calls()).toBe(2));
    } finally {
      vi.useRealTimers();
      nowSpy.mockRestore();
    }
  });
});
