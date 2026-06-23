import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const api = vi.fn();
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

import { ActivePianoProvider } from '../../PianoConfig.jsx';
import { __clearPianoListCache } from '../../usePianoList.js';
import { Videos } from './Videos.jsx';

// Videos renders its own <Routes>, so mount it under a "videos/*" route inside a
// MemoryRouter — mirroring how PianoShell mounts it (path="videos/*"). The course
// id and lecture contentId live in the URL; assertions check the right view per path.
const renderVideos = (plexCollection, initialEntry = '/videos') => render(
  <MemoryRouter initialEntries={[initialEntry]}>
    <ActivePianoProvider
      pianoId="test"
      config={{ videos: { plexCollection }, voices: [], midi: {}, inactivityMinutes: 10 }}
    >
      <Routes>
        <Route path="videos/*" element={<Videos />} />
      </Routes>
    </ActivePianoProvider>
  </MemoryRouter>
);

beforeEach(() => { api.mockReset(); __clearPianoListCache(); });

describe('Videos mode', () => {
  it('lists courses from the configured Plex collection (index route)', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/list/plex/440630') {
        return Promise.resolve({ items: [
          { id: 'plex:1', title: 'Beethoven Sonatas' },
          { id: 'plex:2', title: 'How to Listen to Opera' },
        ] });
      }
      return Promise.resolve({});
    });

    renderVideos('plex:440630');
    // Course tiles are poster-only — the title lives in the tile's title/alt attribute.
    expect(await screen.findByTitle('Beethoven Sonatas')).toBeTruthy();
    expect(screen.getByTitle('How to Listen to Opera')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('api/v1/list/plex/440630');
  });

  it('shows a helpful message when no collection is configured', async () => {
    renderVideos(null);
    await waitFor(() =>
      expect(screen.getByText(/No video library has been set up yet/i)).toBeTruthy()
    );
  });

  it('drills into a course via relative nav, lists its lectures, and goes back', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/list/plex/440630') {
        return Promise.resolve({ items: [{ id: 'plex:1', title: 'Beethoven Sonatas' }] });
      }
      if (path === 'api/v1/fitness/show/1/playable') {
        return Promise.resolve({ info: { title: 'Beethoven Sonatas' }, items: [
          { plex: '10', label: 'Lecture 1' },
          { plex: '11', label: 'Lecture 2' },
        ] });
      }
      return Promise.resolve({});
    });

    renderVideos('plex:440630');
    fireEvent.click(await screen.findByTitle('Beethoven Sonatas'));
    // Now on /videos/1 — CourseDetail with visible lecture captions.
    expect(await screen.findByText('Lecture 1')).toBeTruthy();
    expect(screen.getByText('Lecture 2')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('api/v1/fitness/show/1/playable');

    fireEvent.click(screen.getByRole('button', { name: /back to videos/i }));
    // Back up to the index grid.
    expect(await screen.findByTitle('Beethoven Sonatas')).toBeTruthy();
  });

  it('renders CourseDetail directly from a deep-link to /videos/:courseId', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/fitness/show/1/playable') {
        return Promise.resolve({ info: { title: 'Beethoven Sonatas' }, items: [
          { plex: '10', label: 'Lecture 1' },
        ] });
      }
      return Promise.resolve({});
    });

    renderVideos('plex:440630', '/videos/1');
    // Cold deep-link straight into the course detail (no grid click).
    expect(await screen.findByText('Lecture 1')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('api/v1/fitness/show/1/playable');
  });
});
