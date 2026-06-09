import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let fleetCtx = { devices: [], byDevice: new Map(), loading: true, error: null };
vi.mock('../fleet/FleetProvider.jsx', () => ({
  useFleetContext: vi.fn(() => fleetCtx),
}));

vi.mock('./NavProvider.jsx', () => ({
  useNav: vi.fn(() => ({ push: vi.fn(), pop: vi.fn(), replace: vi.fn(), view: 'fleet', params: {}, depth: 1 })),
}));

vi.mock('../peek/useTakeOver.js', () => ({
  useTakeOver: vi.fn(() => vi.fn(async () => ({ ok: true }))),
}));

import { FleetView } from './FleetView.jsx';

beforeEach(() => {
  fleetCtx = { devices: [], byDevice: new Map(), loading: true, error: null };
});

describe('FleetView', () => {
  it('shows loading state', () => {
    render(<FleetView />);
    expect(screen.getByTestId('fleet-loading')).toBeInTheDocument();
  });

  it('renders one card per device with name + current state', () => {
    fleetCtx = {
      devices: [
        { id: 'lr', name: 'Living Room', type: 'shield-tv' },
        { id: 'ot', name: 'Office', type: 'linux-pc' },
      ],
      byDevice: new Map([
        ['lr', { snapshot: { state: 'playing', currentItem: { contentId: 'plex:1', title: 'Song X' } }, isStale: false, offline: false }],
      ]),
      loading: false, error: null,
    };
    render(<FleetView />);
    expect(screen.getByTestId('fleet-card-lr')).toHaveTextContent('Living Room');
    expect(screen.getByTestId('fleet-card-lr')).toHaveTextContent('playing');
    expect(screen.getByTestId('fleet-card-lr')).toHaveTextContent('Song X');
    expect(screen.getByTestId('fleet-card-ot')).toHaveTextContent('Office');
    expect(screen.getByTestId('fleet-card-ot')).toHaveTextContent(/unknown|—/);
  });

  it('stale entries render a stale indicator', () => {
    fleetCtx = {
      devices: [{ id: 'lr', name: 'Living Room', type: 'shield-tv' }],
      byDevice: new Map([['lr', { snapshot: { state: 'playing', currentItem: null }, isStale: true, offline: false }]]),
      loading: false, error: null,
    };
    render(<FleetView />);
    expect(screen.getByTestId('fleet-card-lr')).toHaveTextContent(/stale/i);
  });

  it('offline entries render offline badge + preserved snapshot', () => {
    fleetCtx = {
      devices: [{ id: 'lr', name: 'Living Room', type: 'shield-tv' }],
      byDevice: new Map([['lr', { snapshot: { state: 'paused', currentItem: { contentId: 'plex:1' } }, isStale: false, offline: true }]]),
      loading: false, error: null,
    };
    render(<FleetView />);
    expect(screen.getByTestId('fleet-card-lr')).toHaveTextContent(/offline/i);
    expect(screen.getByTestId('fleet-card-lr')).toHaveTextContent('paused');
  });

  it('renders empty state when there are no playback surfaces', () => {
    fleetCtx = { devices: [], byDevice: new Map(), loading: false, error: null };
    render(<FleetView />);
    expect(screen.getByTestId('fleet-empty')).toBeInTheDocument();
  });

  function setEntries(entries) {
    fleetCtx = {
      devices: Object.keys(entries).map((id) => ({ id, name: id, type: 'tv' })),
      byDevice: new Map(Object.entries(entries)),
      loading: false, error: null,
    };
  }

  it('hides Take Over for offline/idle devices', () => {
    setEntries({
      tv1: { offline: true, snapshot: { state: 'playing' } },
      tv2: { offline: false, snapshot: { state: 'idle' } },
    });
    render(<FleetView />);
    expect(screen.queryByTestId('fleet-takeover-tv1')).toBeNull();
    expect(screen.queryByTestId('fleet-takeover-tv2')).toBeNull();
  });

  it('shows Take Over for an active session', () => {
    setEntries({ tv1: { offline: false, snapshot: { state: 'playing' } } });
    render(<FleetView />);
    expect(screen.getByTestId('fleet-takeover-tv1')).toBeTruthy();
  });

  it('state dot reflects offline', () => {
    setEntries({ tv1: { offline: true, snapshot: { state: 'playing' } } });
    render(<FleetView />);
    expect(screen.getByTestId('fleet-card-tv1').querySelector('.fleet-card-state').className)
      .toContain('fleet-card-state--offline');
  });
});
