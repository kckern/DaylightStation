import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a), DaylightMediaPath: (p) => p }));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }) }),
}));
vi.mock('../../../hooks/admin/useAdminConfig.js', () => ({
  useAdminConfig: () => ({ data: { quickTags: ['impressionism', 'baroque'] }, load: () => {} }),
}));

import ArtLibrary from './ArtLibrary.jsx';

const renderLib = () => render(<MantineProvider><ArtLibrary /></MantineProvider>);

beforeEach(() => {
  api.mockReset();
  api.mockImplementation((path) => {
    if (path.startsWith('api/v1/admin/art/works')) {
      return Promise.resolve({ total: 1, works: [
        { id: 'a', image: '/img/a.png', meta: { title: 'Sunrise', artist: 'Monet', tags: [], hidden: false, flagged: false } },
      ] });
    }
    return Promise.resolve({ ok: true, meta: { title: 'Sunrise', tags: ['impressionism'] } });
  });
});

describe('ArtLibrary', () => {
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
});
