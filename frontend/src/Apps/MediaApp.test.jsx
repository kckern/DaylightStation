import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../modules/Player/Player.jsx', () => ({
  default: ({ play }) => <div data-testid="player-stub">Player: {play?.contentId ?? 'none'}</div>,
}));
vi.mock('../services/WebSocketService.js', () => ({
  // setAutoReloadEnabled is called on mount (C9.4/C9.7 — a backend outage must
  // not reload the page out from under local playback); without it the mount
  // effect throws and the render assertion never runs.
  wsService: {
    send: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    onStatusChange: vi.fn(() => () => {}),
    setAutoReloadEnabled: vi.fn(),
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

describe('MediaApp', () => {
  beforeEach(() => { localStorage.clear(); });

  it('renders the shell inside the provider stack', () => {
    render(<MediaApp />);
    expect(screen.getByTestId('media-dock')).toBeInTheDocument();
    expect(screen.getByTestId('media-canvas')).toBeInTheDocument();
  });
});
