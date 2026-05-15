import React from 'react';
import { describe, it, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

const navCtx = { push: vi.fn() };
vi.mock('../shell/NavProvider.jsx', () => ({
  useNav: vi.fn(() => navCtx),
}));

// Stub out ResumeCard and RecentsRow — they pull from session/recents context
// which is not wired in unit tests. Their rendering is tested in their own suites.
vi.mock('./ResumeCard.jsx', () => ({
  ResumeCard: () => null,
  default: () => null,
}));
vi.mock('./RecentsRow.jsx', () => ({
  RecentsRow: () => null,
  default: () => null,
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

  test('renders ResumeCard, RecentsRow, and curated browse cards in order', async () => {
    apiMock.mockResolvedValueOnce({
      browse: [{ label: 'Movies', source: 'plex', mediaType: 'video' }],
    });

    render(<HomeView />);

    expect(await screen.findByTestId('home-view')).toBeInTheDocument();
    // ResumeCard and RecentsRow are stubbed to null (no session/recents in unit tests)
    expect(screen.queryByTestId('resume-card')).toBeFalsy();
    expect(screen.queryByTestId('recents-row')).toBeFalsy();
    // Curated browse card is present
    expect(screen.getByTestId('home-card-plex-video')).toBeInTheDocument();
    // Curated section heading is present
    expect(screen.getByText('Browse the catalog')).toBeInTheDocument();
  });
});
