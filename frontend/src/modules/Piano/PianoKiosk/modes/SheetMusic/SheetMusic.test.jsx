import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = vi.fn();
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

import { ActivePianoProvider } from '../../PianoConfig.jsx';
import { SheetMusic } from './SheetMusic.jsx';

const renderSheet = (sheetmusic) => render(
  <ActivePianoProvider
    pianoId="test"
    config={{ videos: { plexCollection: null }, music: {}, sheetmusic, voices: [], midi: {}, inactivityMinutes: 10 }}
  >
    <SheetMusic />
  </ActivePianoProvider>
);

beforeEach(() => api.mockReset());

describe('SheetMusic mode', () => {
  it('lists scores from the configured collection', async () => {
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

  it('opens a score viewer with page images', async () => {
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
    expect(await screen.findByText('‹ Sheet Music')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByAltText('Für Elise — page 1')).toBeTruthy()
    );
  });

  it('shows a helpful message when unconfigured', async () => {
    renderSheet({ collection: null });
    await waitFor(() =>
      expect(screen.getByText(/No sheetmusic.collection configured/i)).toBeTruthy()
    );
  });
});
