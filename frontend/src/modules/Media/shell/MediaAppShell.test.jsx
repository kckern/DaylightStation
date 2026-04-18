import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../Player/Player.jsx', () => ({
  default: ({ play }) => <div data-testid="player-stub">Player: {play?.contentId ?? 'none'}</div>,
}));
vi.mock('../../../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn(), subscribe: vi.fn(() => () => {}), onStatusChange: vi.fn(() => () => {}) },
  default: { send: vi.fn(), subscribe: vi.fn(() => () => {}), onStatusChange: vi.fn(() => () => {}) },
}));
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => {
    if (path === 'api/v1/media/config') return { browse: [], searchScopes: [] };
    return {};
  }),
}));

import { ClientIdentityProvider, CLIENT_ID_KEY } from '../session/ClientIdentityProvider.jsx';
import { LocalSessionProvider } from '../session/LocalSessionProvider.jsx';
import { MediaAppShell } from './MediaAppShell.jsx';

describe('MediaAppShell', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(CLIENT_ID_KEY, 'shell-client-1');
  });

  it('renders Dock + Canvas + Player host', () => {
    render(
      <ClientIdentityProvider>
        <LocalSessionProvider>
          <MediaAppShell />
        </LocalSessionProvider>
      </ClientIdentityProvider>
    );
    expect(screen.getByTestId('media-dock')).toBeInTheDocument();
    expect(screen.getByTestId('media-canvas')).toBeInTheDocument();
  });

  it('reset button clears the session', () => {
    // Preload a session so there is something to reset
    localStorage.setItem('media-app.session', JSON.stringify({
      schemaVersion: 1, sessionId: 'old', updatedAt: 't', wasPlayingOnUnload: false,
      snapshot: {
        sessionId: 'old', state: 'paused',
        currentItem: { contentId: 'plex:42', format: 'video' },
        position: 0,
        queue: { items: [{ queueItemId: 'q1', contentId: 'plex:42', format: 'video', priority: 'queue', addedAt: '' }], currentIndex: 0, upNextCount: 0 },
        config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
        meta: { ownerId: 'shell-client-1', updatedAt: '' },
      },
    }));

    render(
      <ClientIdentityProvider>
        <LocalSessionProvider>
          <MediaAppShell />
        </LocalSessionProvider>
      </ClientIdentityProvider>
    );

    // Home view is default now; navigate to NowPlaying via the MiniPlayer title button
    fireEvent.click(screen.getByTestId('mini-player-open-nowplaying'));
    expect(screen.getByText(/now playing.*plex:42/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('session-reset-btn'));
    expect(screen.queryByText(/now playing.*plex:42/i)).not.toBeInTheDocument();
  });
});
