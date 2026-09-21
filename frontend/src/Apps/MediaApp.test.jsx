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
import { offerActionUndo } from '../modules/Media/actions/actionNotice.jsx';
import { createLocalSessionController } from '../modules/Media/session/LocalSessionController.js';
import { writePersistedSession } from '../modules/Media/session/persistence.js';

describe('MediaApp', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { cleanup(); notifications.clean(); });

  it('keeps an immediate action Undo notice away from the bottom mini-player action region', () => {
    const controller = createLocalSessionController({ clientId: 'notice-layout' });
    controller.queue.playNow({ contentId: 'plex:movie', title: 'Movie', format: 'video' });
    writePersistedSession(controller.getSnapshot());
    render(<MediaApp />);
    act(() => offerActionUndo({ operationId: 'layout', targetName: 'Here', title: 'Movie', undo: async () => ({ ok: true }) }));
    const undo = screen.getByRole('button', { name: 'Undo', exact: true });
    expect(undo).toBeEnabled();
    const noticeRegion = undo.closest('.mantine-Notifications-root');
    // This DOM environment has no hit testing. Assert the real rendered
    // overlay's anchoring contract; browser coverage checks ordinary clicks.
    expect(noticeRegion.style.getPropertyValue('--notifications-bottom')).toBe('');
    expect(noticeRegion.style.getPropertyValue('--notifications-top')).not.toBe('');
    fireEvent.click(screen.getByTestId('mini-player-open-nowplaying'));
    expect(screen.getByTestId('now-playing-view')).toBeInTheDocument();
    expect(undo).toBeEnabled();
  });

  it('renders the shell inside the provider stack', () => {
    render(<MediaApp />);
    expect(screen.getByTestId('media-dock')).toBeInTheDocument();
    expect(screen.getByTestId('media-canvas')).toBeInTheDocument();
  });
});
