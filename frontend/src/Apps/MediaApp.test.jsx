import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import { notifications } from '@mantine/notifications';

vi.mock('../modules/Player/Player.jsx', () => ({
  default: ({ play }) => <div data-testid="player-stub">Player: {play?.contentId ?? 'none'}</div>,
}));
vi.mock('../services/WebSocketService.js', () => ({
  // suppressAutoReload is held on mount (C9.4/C9.7 — a backend outage must
  // not reload the page out from under local playback); without it the mount
  // effect throws and the render assertion never runs.
  wsService: {
    send: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    onStatusChange: vi.fn(() => () => {}),
    suppressAutoReload: vi.fn(() => vi.fn()),
  },
  default: { send: vi.fn(), subscribe: vi.fn(() => () => {}), onStatusChange: vi.fn(() => () => {}) },
}));
vi.mock('../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => {
    if (path === 'api/v1/media/config') {
      return { browse: [], searchScopes: [{ label: 'All', key: 'all', params: 'take=50' }] };
    }
    if (path === 'api/v1/device/config') {
      return { devices: {} };
    }
    return {};
  }),
}));

import MediaApp from './MediaApp.jsx';
import { createLocalSessionController } from '../modules/Media/session/LocalSessionController.js';
import { writePersistedSession } from '../modules/Media/session/persistence.js';

describe('MediaApp', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { cleanup(); notifications.clean(); });

  it('reports a queue edit through the one outcome tray, with Undo outside the mini-player controls', async () => {
    const controller = createLocalSessionController({ clientId: 'notice-layout' });
    controller.queue.playNow({ contentId: 'plex:movie', title: 'Movie', format: 'video' });
    controller.queue.add({ contentId: 'plex:next', title: 'Next', format: 'video' });
    writePersistedSession(controller.getSnapshot());
    render(<MediaApp />);
    fireEvent.click(screen.getByTestId('mini-player-open-nowplaying'));
    expect(screen.getByTestId('now-playing-view')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('queue-clear'));
    const tray = await screen.findByTestId('dispatch-tray');
    expect(tray).toHaveTextContent('Cleared the queue here');
    const undo = screen.getByTestId('item-action-undo');
    expect(tray.contains(undo)).toBe(true);
    expect(screen.queryByTestId('media-mini-player')?.contains(undo) ?? false).toBe(false);
    expect(undo).toBeEnabled();
    expect(screen.getByTestId('media-outcome-announcer')).toHaveTextContent('Cleared the queue here');
  });

  it('renders the shell inside the provider stack', () => {
    render(<MediaApp />);
    expect(screen.getByTestId('media-dock')).toBeInTheDocument();
    expect(screen.getByTestId('media-canvas')).toBeInTheDocument();
  });
});
