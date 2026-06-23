import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = vi.fn();
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

import { ActivePianoProvider } from '../../PianoConfig.jsx';
import { Music } from './Music.jsx';

const renderMusic = (music) => render(
  <ActivePianoProvider
    pianoId="test"
    config={{ videos: { plexCollection: null }, music, voices: [], midi: {}, inactivityMinutes: 10 }}
  >
    <Music />
  </ActivePianoProvider>
);

beforeEach(() => api.mockReset());

describe('Music mode', () => {
  it('lists collection albums plus playlists as tiles', async () => {
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

  it('opens an album and lists its tracks with Play All', async () => {
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
    expect(await screen.findByText('Scene 1')).toBeTruthy();
    expect(screen.getByText('Scene 2')).toBeTruthy();
    expect(screen.getByText('▶ Play All')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('api/v1/queue/plex:80962');
  });

  it('shows a helpful message when nothing is configured', async () => {
    renderMusic({ collection: null, playlists: [] });
    await waitFor(() =>
      expect(screen.getByText(/No music.collection configured/i)).toBeTruthy()
    );
  });
});
