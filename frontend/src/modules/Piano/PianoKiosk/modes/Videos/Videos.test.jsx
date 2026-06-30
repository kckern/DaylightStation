import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const api = vi.fn();
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

import { ActivePianoProvider } from '../../PianoConfig.jsx';
import { PianoUserProvider } from '../../PianoUserContext.jsx';
import { __clearPianoListCache } from '../../usePianoList.js';
import { Videos } from './Videos.jsx';

// Videos renders its own <Routes>, so mount it under a "videos/*" route inside a
// MemoryRouter — mirroring how PianoShell mounts it (path="videos/*"). The course
// id and lecture contentId live in the URL; assertions check the right view per path.
// CourseDetail now reads the current user from PianoUserProvider (the roster mock
// below returns no users, so currentUser stays null and the course hook falls back
// to the device-level fitness show endpoint these tests already mock).
const renderVideosCfg = (videos, initialEntry = '/videos') => render(
  <MemoryRouter initialEntries={[initialEntry]}>
    <ActivePianoProvider
      pianoId="test"
      config={{ videos, voices: [], midi: {}, inactivityMinutes: 10 }}
    >
      <PianoUserProvider pianoId="test">
        <Routes>
          <Route path="videos/*" element={<Videos />} />
        </Routes>
      </PianoUserProvider>
    </ActivePianoProvider>
  </MemoryRouter>
);
// Legacy convenience: a flat plexCollection (string/null) → a single grid, no tabs.
const renderVideos = (plexCollection, initialEntry = '/videos') =>
  renderVideosCfg({ plexCollection }, initialEntry);

beforeEach(() => { api.mockReset(); api.mockResolvedValue({}); __clearPianoListCache(); });

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

  it('renders a tab per group; a group merges its collections; tabs switch', async () => {
    api.mockImplementation((path) => {
      // "Music Lessons" tab merges two collections...
      if (path === 'api/v1/list/plex/675686') {
        return Promise.resolve({ title: 'Music Lessons', items: [{ id: 'plex:1', title: 'How to Play Piano' }] });
      }
      if (path === 'api/v1/list/plex/676074') {
        return Promise.resolve({ title: 'Piano Courses', items: [{ id: 'plex:2', title: 'Hoffman Academy', type: 'show' }] });
      }
      // ...the second tab is the appreciation collection.
      if (path === 'api/v1/list/plex/675687') {
        return Promise.resolve({ title: 'Music Appreciation', items: [{ id: 'plex:3', title: 'Symphonies of Beethoven' }] });
      }
      return Promise.resolve({});
    });

    renderVideosCfg({
      collections: [
        { label: 'Music Lessons', plex: ['plex:675686', 'plex:676074'] },
        { label: 'Music Appreciation', plex: ['plex:675687'] },
      ],
    });

    const lessonsTab = await screen.findByRole('tab', { name: 'Music Lessons' });
    const apprTab = screen.getByRole('tab', { name: 'Music Appreciation' });
    expect(lessonsTab.getAttribute('aria-selected')).toBe('true'); // first tab default

    // The Lessons tab MERGES both of its collections (Hoffman sorts first as a show).
    expect(await screen.findByTitle('Hoffman Academy')).toBeTruthy();
    expect(screen.getByTitle('How to Play Piano')).toBeTruthy();
    expect(screen.queryByTitle('Symphonies of Beethoven')).toBeNull();

    // Switching to Appreciation swaps the wall to that collection.
    fireEvent.click(apprTab);
    expect(await screen.findByTitle('Symphonies of Beethoven')).toBeTruthy();
    expect(screen.queryByTitle('Hoffman Academy')).toBeNull();
  });

  it('shows a helpful message when no collection is configured', async () => {
    renderVideos(null);
    await waitFor(() =>
      expect(screen.getByText(/No video library has been set up yet/i)).toBeTruthy()
    );
  });

  it('overlays sequential badge + per-user progress chips from the progress endpoint', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/list/plex/440630') {
        return Promise.resolve({ items: [{ id: 'plex:2', title: 'Hoffman Academy', type: 'show' }] });
      }
      if (path.startsWith('api/v1/piano/courses/progress')) {
        expect(path).toContain('ids=plex:2');
        return Promise.resolve({ courses: {
          'plex:2': { isSequential: true, total: 40, users: [{ id: 'felix', name: 'Felix', completed: 12, total: 40 }] },
        } });
      }
      return Promise.resolve({});
    });

    renderVideos('plex:440630');
    expect(await screen.findByTitle('Hoffman Academy')).toBeTruthy();
    expect(await screen.findByLabelText('Sequential course')).toBeTruthy();
    expect(await screen.findByText('12/40')).toBeTruthy();
  });

  it('drills into a course via relative nav and lists its lectures', async () => {
    // Back-to-grid navigation now lives in the shared breadcrumb chrome (the
    // "Videos" mode crumb), not in CourseDetail — so this isolated mode test
    // only covers the drill-in.
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
