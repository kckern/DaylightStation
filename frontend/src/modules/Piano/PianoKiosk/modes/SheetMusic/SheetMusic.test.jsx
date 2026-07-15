import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const api = vi.fn();
const apiText = vi.fn();
vi.mock('../../../../../lib/api.mjs', () => ({
  DaylightAPI: (...a) => api(...a),
  DaylightAPIText: (...a) => apiText(...a),
}));

// Stub the engraver so the notation path doesn't pull in VexFlow/MIDI here — we
// only assert the right view mounts and the raw XML reaches it.
vi.mock('./ScorePlayer.jsx', () => ({
  default: ({ score }) => <div data-testid="score-player">player:{score?.musicXml}</div>,
}));

import { ActivePianoProvider } from '../../PianoConfig.jsx';
import { __clearPianoListCache } from '../../usePianoList.js';
import { SheetMusic, collectionListPath, isNotationId } from './SheetMusic.jsx';

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

beforeEach(() => { api.mockReset(); apiText.mockReset(); __clearPianoListCache(); });

describe('collectionListPath', () => {
  it('maps a files: ref to a generic list path', () => {
    expect(collectionListPath('files:docs/sheet-music')).toBe('api/v1/list/files/docs/sheet-music');
  });
  it('maps a plex: ref and a bare (legacy) id to a plex list path', () => {
    expect(collectionListPath('plex:359812')).toBe('api/v1/list/plex/359812');
    expect(collectionListPath('700100')).toBe('api/v1/list/plex/700100');
  });
  it('returns null when no collection is configured', () => {
    expect(collectionListPath(null)).toBe(null);
  });
});

describe('isNotationId (H4)', () => {
  it('treats .musicxml as engraved notation', () => {
    expect(isNotationId('files:docs/x.musicxml')).toBe(true);
    expect(isNotationId('x.MUSICXML')).toBe(true);
  });
  it('routes .mxl to the notation player (backend decompresses the zip container)', () => {
    expect(isNotationId('files:docs/x.mxl')).toBe(true);
    expect(isNotationId('x.MXL')).toBe(true);
  });
  it('non-notation ids are false', () => {
    expect(isNotationId('plex:12345')).toBe(false);
  });
});

describe('SheetMusic mode', () => {
  it('lists notation files from the configured folder (index route)', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/list/files/docs/sheet-music') {
        return Promise.resolve({ items: [
          { id: 'files:docs/sheet-music/fur-elise-super-easy.musicxml', title: 'fur-elise-super-easy', type: 'notation' },
          { id: 'files:docs/sheet-music/clair-de-lune.musicxml', title: 'clair-de-lune', type: 'notation' },
        ] });
      }
      return Promise.resolve({});
    });

    renderSheet({ collection: 'files:docs/sheet-music' });
    // Filename-derived titles are prettified for the grid.
    expect(await screen.findByTitle('Fur Elise Super Easy')).toBeTruthy();
    expect(screen.getByTitle('Clair De Lune')).toBeTruthy();
  });

  it('shows an empty-state when no collection is configured', async () => {
    renderSheet({ collection: null });
    await waitFor(() =>
      expect(screen.getByText('No sheet music has been set up yet.')).toBeTruthy()
    );
  });

  it('opens a MusicXML score in the engraved player, fetching its raw XML', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/list/files/docs/sheet-music') {
        return Promise.resolve({ items: [
          { id: 'files:docs/sheet-music/fur-elise-super-easy.musicxml', title: 'fur-elise-super-easy', type: 'notation' },
        ] });
      }
      return Promise.resolve({});
    });
    apiText.mockResolvedValue('<score-partwise/>');

    renderSheet({ collection: 'files:docs/sheet-music' });
    fireEvent.click(await screen.findByTitle('Fur Elise Super Easy'));

    // Raw XML is fetched from the media stream endpoint and handed to ScorePlayer.
    expect(await screen.findByTestId('score-player')).toHaveTextContent('player:<score-partwise/>');
    expect(apiText).toHaveBeenCalledWith(
      'api/v1/proxy/media/stream/docs%2Fsheet-music%2Ffur-elise-super-easy.musicxml'
    );
  });

  it('renders the engraved player directly from a deep-link to a notation id', async () => {
    apiText.mockResolvedValue('<score-partwise/>');
    renderSheet(
      { collection: 'files:docs/sheet-music' },
      '/sheetmusic/view/files:docs/sheet-music/fur-elise-super-easy.musicxml'
    );
    expect(await screen.findByTestId('score-player')).toHaveTextContent('player:<score-partwise/>');
  });

  it('opens a .mxl deep-link in the engraved player when it has NO sidecar image', async () => {
    api.mockResolvedValue({}); // info resolves with no image → engrave
    apiText.mockResolvedValue('<score-partwise/>');
    renderSheet(
      { collection: 'files:docs/sheet-music' },
      '/sheetmusic/view/files:docs/sheet-music/on-smokey-before-i-gomxl.mxl'
    );
    expect(await screen.findByTestId('score-player')).toHaveTextContent('player:<score-partwise/>');
    expect(apiText).toHaveBeenCalledWith(
      'api/v1/proxy/media/stream/docs%2Fsheet-music%2Fon-smokey-before-i-gomxl.mxl'
    );
  });

  it('shows the sidecar image (not the engraver) for a score that has one', async () => {
    // info resolves the same-basename .jpg scan as the score's image.
    api.mockImplementation((path) => {
      if (path === 'api/v1/info/files/docs/sheet-music/the-adventures-of-tintin-theme.mxl') {
        return Promise.resolve({ title: 'The Adventures of Tintin', image: '/api/v1/proxy/media/stream/tintin.jpg' });
      }
      return Promise.resolve({});
    });
    apiText.mockResolvedValue('<score-partwise/>');

    renderSheet(
      { collection: 'files:docs/sheet-music' },
      '/sheetmusic/view/files:docs/sheet-music/the-adventures-of-tintin-theme.mxl'
    );
    // The curated scan renders as a page image; the engraved player is NOT mounted.
    const img = await screen.findByAltText('The Adventures of Tintin — page 1');
    expect(img.getAttribute('src')).toBe('/api/v1/proxy/media/stream/tintin.jpg');
    expect(screen.queryByTestId('score-player')).toBeNull();
    // The raw-XML stream is never fetched — no engraving happened.
    expect(apiText).not.toHaveBeenCalled();
  });

  it('falls back to the page-image viewer for a non-notation (Plex) score', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/list/plex/1') {
        return Promise.resolve({ items: [{ id: 'plex:1a', image: '/p1' }, { id: 'plex:1b', image: '/p2' }] });
      }
      return Promise.resolve({});
    });

    renderSheet({ collection: 'plex:700100' }, '/sheetmusic/view/plex:1');
    // ScoreViewer fetches the page list from the id in the URL.
    expect(await screen.findByAltText('Score — page 1')).toBeTruthy();
    expect(screen.getByAltText('Score — page 2')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('api/v1/list/plex/1');
  });
});
