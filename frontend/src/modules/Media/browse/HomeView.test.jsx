import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

const navCtx = { push: vi.fn() };
vi.mock('../shell/NavProvider.jsx', () => ({
  useNav: vi.fn(() => navCtx),
}));

import { HomeView } from './HomeView.jsx';

beforeEach(() => {
  apiMock.mockReset();
  navCtx.push.mockClear();
});

describe('HomeView', () => {
  it('renders cards for each browse entry from /api/v1/media/config', async () => {
    apiMock.mockResolvedValueOnce({
      browse: [
        { source: 'plex', mediaType: 'audio', label: 'Browse Music' },
        { source: 'plex', mediaType: 'video', label: 'Browse Video' },
      ],
    });
    render(<HomeView />);
    await waitFor(() => expect(screen.getByText('Browse Music')).toBeInTheDocument());
    expect(screen.getByText('Browse Video')).toBeInTheDocument();
  });

  it('clicking a card navigates to browse with a path derived from source/mediaType', async () => {
    apiMock.mockResolvedValueOnce({
      browse: [{ source: 'plex', mediaType: 'audio', label: 'Browse Music' }],
    });
    render(<HomeView />);
    await waitFor(() => screen.getByText('Browse Music'));
    fireEvent.click(screen.getByTestId('home-card-plex-audio'));
    expect(navCtx.push).toHaveBeenCalledWith('browse', expect.objectContaining({ path: expect.any(String) }));
  });

  it('renders a placeholder on API failure', async () => {
    apiMock.mockRejectedValueOnce(new Error('fail'));
    render(<HomeView />);
    await waitFor(() => expect(screen.getByTestId('home-error')).toBeInTheDocument());
  });
});
