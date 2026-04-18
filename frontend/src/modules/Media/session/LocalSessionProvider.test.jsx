import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Prevent real Player from rendering inside the provider
vi.mock('../../Player/Player.jsx', () => ({
  default: ({ play }) => <div data-testid="player-stub">{play?.contentId ?? 'none'}</div>,
}));

// Stub wsService to avoid real WebSocket
vi.mock('../../../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn(), subscribe: vi.fn(() => () => {}), onStatusChange: vi.fn(() => () => {}) },
  default: { send: vi.fn(), subscribe: vi.fn(() => () => {}), onStatusChange: vi.fn(() => () => {}) },
}));

import { ClientIdentityProvider, CLIENT_ID_KEY } from './ClientIdentityProvider.jsx';
import { LocalSessionProvider } from './LocalSessionProvider.jsx';
import { useSessionController } from './useSessionController.js';

function Probe() {
  const ctl = useSessionController('local');
  return <div>state={ctl.snapshot.state};item={ctl.snapshot.currentItem?.contentId ?? 'none'}</div>;
}

describe('LocalSessionProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(CLIENT_ID_KEY, 'test-client-1234567890');
  });

  it('bootstraps an idle session when no localStorage', () => {
    render(
      <ClientIdentityProvider>
        <LocalSessionProvider>
          <Probe />
        </LocalSessionProvider>
      </ClientIdentityProvider>
    );
    expect(screen.getByText(/state=idle;item=none/)).toBeInTheDocument();
  });

  it('hydrates from persisted session', () => {
    localStorage.setItem('media-app.session', JSON.stringify({
      schemaVersion: 1,
      sessionId: 'old',
      updatedAt: 't',
      wasPlayingOnUnload: false,
      snapshot: {
        sessionId: 'old',
        state: 'paused',
        currentItem: { contentId: 'plex:99', format: 'video', title: 'Resumed' },
        position: 30,
        queue: { items: [], currentIndex: -1, upNextCount: 0 },
        config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
        meta: { ownerId: 'test-client-1234567890', updatedAt: '' },
      },
    }));
    render(
      <ClientIdentityProvider>
        <LocalSessionProvider>
          <Probe />
        </LocalSessionProvider>
      </ClientIdentityProvider>
    );
    expect(screen.getByText(/state=paused;item=plex:99/)).toBeInTheDocument();
  });
});

describe('LocalSessionProvider — URL + broadcast wiring', () => {
  it('processes ?play=... on mount', () => {
    const origDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?play=plex-main:77' },
      configurable: true,
    });
    try {
      render(
        <ClientIdentityProvider>
          <LocalSessionProvider>
            <Probe />
          </LocalSessionProvider>
        </ClientIdentityProvider>
      );
      expect(screen.getByText(/item=plex-main:77/)).toBeInTheDocument();
    } finally {
      if (origDescriptor) Object.defineProperty(window, 'location', origDescriptor);
    }
  });
});
