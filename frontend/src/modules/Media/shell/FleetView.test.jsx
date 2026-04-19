import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let fleetCtx = { devices: [], byDevice: new Map(), loading: true, error: null };
vi.mock('../fleet/FleetProvider.jsx', () => ({
  useFleetContext: vi.fn(() => fleetCtx),
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
});
