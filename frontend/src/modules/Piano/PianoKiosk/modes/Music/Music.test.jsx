import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const api = vi.fn();
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

import { ActivePianoProvider } from '../../PianoConfig.jsx';
import { __clearPianoListCache } from '../../usePianoList.js';
import { Music } from './Music.jsx';

// Music renders its own <Routes>, so mount it under a "music/*" route inside a
// MemoryRouter — mirroring how PianoShell mounts it (path="music/*"). The
// album/playlist id and starting track live in the URL; assertions check the
// right view per path.
const renderMusic = (music, initialEntry = '/music') => render(
  <MemoryRouter initialEntries={[initialEntry]}>
    <ActivePianoProvider
      pianoId="test"
      config={{ videos: { plexCollection: null }, music, voices: [], midi: {}, inactivityMinutes: 10 }}
    >
      <Routes>
        <Route path="music/*" element={<Music />} />
      </Routes>
    </ActivePianoProvider>
  </MemoryRouter>
);

beforeEach(() => { api.mockReset(); __clearPianoListCache(); });

describe('Music mode', () => {
  it('lists collection albums plus playlists as tiles (index route)', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/list/plex/359812') {
        return Promise.resolve({ items: [{ id: 'plex:80962', title: 'Der Ring', image: '/a' }] });
      }
      if (path === 'api/v1/list/plex/622894') {
        return Promise.resolve({ items: [{ id: 'plex:622894', title: 'Relaxing Classical', image: '/p' }] });
      }
      return Promise.resolve({});
    });

    renderMusic({ collection: 'plex:359812', playlists: ['plex:622894'] });
    expect(await screen.findByTitle('Der Ring')).toBeTruthy();
    expect(screen.getByTitle('Relaxing Classical')).toBeTruthy();
  });

  it('shows a helpful message when nothing is configured', async () => {
    renderMusic({ collection: null, playlists: [] });
    await waitFor(() =>
      expect(screen.getByText(/No music has been set up yet/i)).toBeTruthy()
    );
  });

  it('drills into an album via relative nav, lists its tracks with Play All, and goes back', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/list/plex/359812') {
        return Promise.resolve({ items: [{ id: 'plex:80962', title: 'Der Ring', image: '/a' }] });
      }
      if (path === 'api/v1/queue/plex:80962') {
        return Promise.resolve({ items: [
          { contentId: 'plex:1', title: 'Scene 1', mediaUrl: '/u1', grandparentTitle: 'Wagner', duration: 1450 },
          { contentId: 'plex:2', title: 'Scene 2', mediaUrl: '/u2', grandparentTitle: 'Wagner', duration: 2740 },
        ] });
      }
      return Promise.resolve({});
    });

    renderMusic({ collection: 'plex:359812', playlists: [] });
    fireEvent.click(await screen.findByTitle('Der Ring'));
    // Now on /music/80962 — AlbumDetail with the track list.
    expect(await screen.findByText('Scene 1')).toBeTruthy();
    expect(screen.getByText('Scene 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: /play all/i })).toBeTruthy();
    expect(api).toHaveBeenCalledWith('api/v1/queue/plex:80962');

    fireEvent.click(screen.getByRole('button', { name: /back to music/i }));
    // Back up to the index grid.
    expect(await screen.findByTitle('Der Ring')).toBeTruthy();
  });

  it('renders AlbumDetail directly from a deep-link to /music/:albumId', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/queue/plex:80962') {
        return Promise.resolve({ items: [
          { contentId: 'plex:1', title: 'Scene 1', mediaUrl: '/u1', grandparentTitle: 'Wagner', duration: 1450 },
        ] });
      }
      return Promise.resolve({});
    });

    renderMusic({ collection: 'plex:359812', playlists: [] }, '/music/80962');
    // Cold deep-link straight into the album detail (no grid click).
    expect(await screen.findByText('Scene 1')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('api/v1/queue/plex:80962');
  });
});
