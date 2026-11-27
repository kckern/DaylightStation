// Watch marks on tiles (2026-11-27, jellyfin study rec 11).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});
const apiMock = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => apiMock(...a) }));
import { HomeTile } from "./HomeTile.jsx";
import { resetUnwatchedCounts } from "./unwatchedCounts.js";

beforeEach(() => { apiMock.mockReset(); resetUnwatchedCounts(); });
const mount = (item, props = {}) => render(<MantineProvider><HomeTile item={item} testId="t" {...props} /></MantineProvider>);

describe('HomeTile watch marks', () => {
  it('a show tile shows how many episodes are unwatched', async () => {
    apiMock.mockResolvedValue({ counts: { 'plex:59493': { unwatched: 8, total: 155 } } });
    mount({ id: 'plex:59493', title: 'Bluey', type: 'show' });
    expect(await screen.findByTestId('t-badge')).toHaveTextContent('8');
    expect(screen.getByTestId('t-badge')).toHaveAttribute('aria-label', '8 unwatched');
  });
  it('a fully watched season shows ✓; a finished film shows ✓; nothing otherwise', async () => {
    apiMock.mockResolvedValue({ counts: { 'plex:2': { unwatched: 0, total: 4 } } });
    const { unmount } = mount({ id: 'plex:2', title: 'Season 1', type: 'season' });
    expect(await screen.findByTestId('t-badge')).toHaveAttribute('aria-label', 'Watched');
    unmount();
    const film = mount({ id: 'plex:3', title: 'Arrival', type: 'movie' }, { watched: true });
    expect(screen.getByTestId('t-badge')).toHaveAttribute('aria-label', 'Watched');
    film.unmount();
    mount({ id: 'plex:4', title: 'Arrival', type: 'movie' });
    expect(screen.queryByTestId('t-badge')).toBeNull();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});
