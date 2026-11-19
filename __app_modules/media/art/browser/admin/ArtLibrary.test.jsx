import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const api = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => api(...a), DaylightMediaPath: (p) => p }));
vi.mock("../../../../../frontend/src/lib/logging/Logger.js", () => ({
  default: () => ({ child: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }) }),
}));
import ArtLibrary from "./ArtLibrary.jsx";

const renderLib = () => render(<MantineProvider><ArtLibrary /></MantineProvider>);

beforeEach(() => {
  api.mockReset();
  api.mockImplementation((path) => {
    if (path.includes('/config/files/')) return Promise.resolve({ parsed: { quickTags: ['impressionism', 'baroque'] } });
    if (path.startsWith('api/v1/admin/art/works')) {
      return Promise.resolve({ total: 1, works: [
        { id: 'a', image: '/img/a.png', meta: { title: 'Sunrise', artist: 'Monet', tags: [], hidden: false, flagged: false } },
      ] });
    }
    return Promise.resolve({ ok: true, meta: { title: 'Sunrise', tags: ['impressionism'] } });
  });
});

describe('ArtLibrary', () => {
  it.each([['/config/files/', 'Artwork settings'], ['/art/works', 'Artwork']])('recovers a failed %s request', async (fragment, label) => {
    const success = api.getMockImplementation();
    let failed = false;
    api.mockImplementation((path, ...args) => {
      if (!failed && path.includes(fragment)) {
        failed = true;
        return Promise.reject(new Error('Unavailable'));
      }
      return success(path, ...args);
    });
    renderLib();
    expect(await screen.findByText(label + ' failed to load')).toBeTruthy();
    if (fragment.includes('config')) expect(await screen.findByText('Sunrise')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(await screen.findByText('Sunrise')).toBeTruthy();
    expect(await screen.findByText(/1–2 quick-tag/)).toBeTruthy();
  });

  it('renders the focused work title', async () => {
    renderLib();
    await waitFor(() => expect(screen.getByText('Sunrise')).toBeTruthy());
  });

  it('pressing "1" applies the first quick-tag via PATCH', async () => {
    renderLib();
    await waitFor(() => expect(screen.getByText('Sunrise')).toBeTruthy());
    fireEvent.keyDown(window, { key: '1' });
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('api/v1/admin/art/works/a', { tags: ['impressionism'] }, 'PATCH'));
  });

  it('pressing "x" toggles hidden via PATCH', async () => {
    renderLib();
    await waitFor(() => expect(screen.getByText('Sunrise')).toBeTruthy());
    fireEvent.keyDown(window, { key: 'x' });
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('api/v1/admin/art/works/a', { hidden: true }, 'PATCH'));
  });

  // Typing in search must not throw and must reload the list with the q filter.
  // (jsdom flushes updaters synchronously so it can't reproduce the null-currentTarget
  // timing bug, but this guards the handler shape + the search→reload path.)
  it('search reloads the list with a q filter', async () => {
    renderLib();
    await waitFor(() => expect(screen.getByText('Sunrise')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('search title / artist…'), { target: { value: 'monet' } });
    await waitFor(() =>
      expect(api.mock.calls.some(([p]) => typeof p === 'string' && p.includes('q=monet'))).toBe(true));
  });

  it('toggling "Don\'t crop" PATCHes crop.enabled:false', async () => {
    renderLib();
    await waitFor(() => expect(screen.getByText('Sunrise')).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/don.t crop/i));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('api/v1/admin/art/works/a', { crop: { enabled: false } }, 'PATCH'));
  });
});
