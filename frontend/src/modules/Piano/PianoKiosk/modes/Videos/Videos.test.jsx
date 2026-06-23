import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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
  it('lists items from the configured Plex collection', async () => {
    api.mockImplementation((path) => {
      if (path === 'api/v1/list/plex/440630') {
        return Promise.resolve({ items: [
          { id: 'plex:1', title: 'C Major Scale' },
          { id: 'plex:2', title: 'Sight Reading 101' },
        ] });
      }
      return Promise.resolve({}); // benign default
    });

    renderVideos('plex:440630');
    expect(await screen.findByText('C Major Scale')).toBeTruthy();
    expect(screen.getByText('Sight Reading 101')).toBeTruthy();
    // ratingKey was stripped of the plex: prefix before the list call.
    expect(api).toHaveBeenCalledWith('api/v1/list/plex/440630');
  });

  it('shows a helpful message when no collection is configured', async () => {
    renderVideos(null);
    await waitFor(() =>
      expect(screen.getByText(/No videos.plexCollection configured/i)).toBeTruthy()
    );
  });
});
