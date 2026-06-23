import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = vi.fn();
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

import { ActivePianoProvider } from '../../PianoConfig.jsx';
import { Videos } from './Videos.jsx';

const renderVideos = (plexCollection) => render(
  <ActivePianoProvider
    pianoId="test"
    config={{ videos: { plexCollection }, voices: [], midi: {}, inactivityMinutes: 10 }}
  >
    <Videos />
  </ActivePianoProvider>
);

beforeEach(() => api.mockReset());

describe('Videos mode', () => {
  it('lists courses from the configured Plex collection', async () => {
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
    // Course tiles are poster-only — the title lives in the tile's title/alt
    // attribute, not as a visible caption.
    expect(await screen.findByTitle('Beethoven Sonatas')).toBeTruthy();
    expect(screen.getByTitle('How to Listen to Opera')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('api/v1/list/plex/440630');
  });

  it('shows a helpful message when no collection is configured', async () => {
    renderVideos(null);
    await waitFor(() =>
      expect(screen.getByText(/No videos.plexCollection configured/i)).toBeTruthy()
    );
  });

  it('drills into a course, lists its lectures, and goes back', async () => {
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
    // Lectures keep visible caption titles (CourseDetail).
    expect(await screen.findByText('Lecture 1')).toBeTruthy();
    expect(screen.getByText('Lecture 2')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('api/v1/fitness/show/1/playable');

    fireEvent.click(screen.getByText('‹ Courses'));
    expect(await screen.findByTitle('Beethoven Sonatas')).toBeTruthy();
  });
});
