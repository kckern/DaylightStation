import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const api = vi.fn();
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

import { ActivePianoProvider } from '../../PianoConfig.jsx';
import { __clearPianoListCache } from '../../usePianoList.js';
import { SheetMusic } from './SheetMusic.jsx';

// SheetMusic renders its own <Routes>, so mount it under a "sheetmusic/*" route
// inside a MemoryRouter — mirroring how PianoShell mounts it (path="sheetmusic/*").
// The score id lives in the URL; assertions check the right view per path.
const renderSheet = (sheetmusic, initialEntry = '/sheetmusic') => render(
  <MemoryRouter initialEntries={[initialEntry]}>
    <ActivePianoProvider
      pianoId="test"
      config={{ videos: { plexCollection: null }, music: {}, sheetmusic, voices: [], midi: {}, inactivityMinutes: 10 }}
    >
      <Routes>
        <Route path="sheetmusic/*" element={<SheetMusic />} />
      </Routes>
    </ActivePianoProvider>
  </MemoryRouter>
);

beforeEach(() => { api.mockReset(); __clearPianoListCache(); });

describe('SheetMusic mode', () => {
  it('lists scores from the configured collection (index route)', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/list/plex/700100') {
        return Promise.resolve({ items: [
          { id: 'plex:1', title: 'Für Elise', image: '/a' },
          { id: 'plex:2', title: 'Clair de Lune', image: '/b' },
        ] });
      }
      return Promise.resolve({});
    });

    renderSheet({ collection: 'plex:700100' });
    expect(await screen.findByTitle('Für Elise')).toBeTruthy();
    expect(screen.getByTitle('Clair de Lune')).toBeTruthy();
  });

  it('shows a helpful message when unconfigured', async () => {
    renderSheet({ collection: null });
    await waitFor(() =>
      expect(screen.getByText(/No sheetmusic.collection configured/i)).toBeTruthy()
    );
  });

  it('navigates to a score viewer via relative nav and shows page images', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/list/plex/700100') {
        return Promise.resolve({ items: [{ id: 'plex:1', title: 'Für Elise', image: '/a' }] });
      }
      if (path === 'api/v1/list/plex/1') {
        return Promise.resolve({ items: [{ id: 'plex:1a', image: '/p1' }, { id: 'plex:1b', image: '/p2' }] });
      }
      return Promise.resolve({});
    });

    renderSheet({ collection: 'plex:700100' });
    fireEvent.click(await screen.findByTitle('Für Elise'));
    // Now on /sheetmusic/1 — ScoreViewer with back button.
    expect(await screen.findByText('‹ Sheet Music')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByAltText('Score — page 1')).toBeTruthy()
    );

    fireEvent.click(screen.getByText('‹ Sheet Music'));
    // Back up to the index grid.
    expect(await screen.findByTitle('Für Elise')).toBeTruthy();
  });

  it('renders ScoreViewer directly from a deep-link to /sheetmusic/:scoreId', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/list/plex/1') {
        return Promise.resolve({ items: [{ id: 'plex:1a', image: '/p1' }] });
      }
      return Promise.resolve({});
    });

    renderSheet({ collection: 'plex:700100' }, '/sheetmusic/1');
    // Cold deep-link — ScoreViewer fetches pages from the id in the URL.
    expect(await screen.findByText('‹ Sheet Music')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByAltText('Score — page 1')).toBeTruthy()
    );
    expect(api).toHaveBeenCalledWith('api/v1/list/plex/1');
  });
});
