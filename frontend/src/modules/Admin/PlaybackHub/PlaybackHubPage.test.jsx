import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// Mocked hooks — controlled per-test via the implementations below.
const hubConfigState = { config: null, loading: true, error: null };
const hubStatusMap = new Map();
const hubStatusState = { fetchedAt: new Date() };
const hubMutations = {
  sendCommand: vi.fn(),
  updateDevice: vi.fn(),
  saveFire: vi.fn(),
  deleteFire: vi.fn(),
};

vi.mock('./hooks/useHubStatus', () => ({
  useHubStatus: () => ({ devices: hubStatusMap, fetchedAt: hubStatusState.fetchedAt }),
}));

vi.mock('./hooks/useHubConfig', () => ({
  useHubConfig: () => ({
    config: hubConfigState.config,
    loading: hubConfigState.loading,
    error: hubConfigState.error,
    revalidate: vi.fn(),
  }),
}));

vi.mock('./hooks/useHubMutations', () => ({
  useHubMutations: () => hubMutations,
}));

// Mock DeviceCard so we can record the props each card receives without
// pulling in the whole composition.
const deviceCardCalls = [];
vi.mock('./components/DeviceCard', () => ({
  __esModule: true,
  default: (props) => {
    deviceCardCalls.push(props);
    return (
      <div
        data-testid="device-card"
        data-color={props.slot.color}
        data-fire-count={props.scheduledFires?.length ?? 0}
      >
        card-{props.slot.color}
      </div>
    );
  },
}));

import PlaybackHubPage from './PlaybackHubPage.jsx';

function renderPage() {
  return render(
    <MantineProvider>
      <PlaybackHubPage />
    </MantineProvider>
  );
}

describe('PlaybackHubPage', () => {
  beforeEach(() => {
    hubConfigState.config = null;
    hubConfigState.loading = true;
    hubConfigState.error = null;
    hubStatusMap.clear();
    hubStatusState.fetchedAt = new Date();
    deviceCardCalls.length = 0;
  });

  it('renders a Loader while config is loading and no config yet', () => {
    hubConfigState.loading = true;
    hubConfigState.config = null;
    const { container } = renderPage();
    // Mantine Loader has aria role "presentation"; just check class fallback
    expect(container.querySelector('.mantine-Loader-root')).toBeTruthy();
  });

  it('renders an Alert with the error message when config failed to load', () => {
    hubConfigState.loading = false;
    hubConfigState.config = null;
    hubConfigState.error = 'kaboom';
    renderPage();
    expect(screen.getByText(/Couldn't load Playback Hub config/i)).toBeInTheDocument();
    expect(screen.getByText(/kaboom/i)).toBeInTheDocument();
  });

  it('renders empty-state text when config has no devices', () => {
    hubConfigState.loading = false;
    hubConfigState.config = { devices: [], scheduled: [] };
    renderPage();
    expect(screen.getByText(/No devices configured/i)).toBeInTheDocument();
  });

  it('renders one DeviceCard per device in order: red, yellow, green, blue, white', () => {
    hubConfigState.loading = false;
    hubConfigState.config = {
      devices: [
        { color: 'red',    class: 'private', volume: { default: 50, min: 0, max: 75 } },
        { color: 'yellow', class: 'private', volume: { default: 50, min: 0, max: 75 } },
        { color: 'green',  class: 'private', volume: { default: 50, min: 0, max: 75 } },
        { color: 'blue',   class: 'private', volume: { default: 50, min: 0, max: 75 } },
        { color: 'white',  class: 'public',  volume: { default: 40, min: 0, max: 70 } },
      ],
      scheduled: [],
    };
    renderPage();
    const cards = screen.getAllByTestId('device-card');
    expect(cards).toHaveLength(5);
    expect(cards.map(c => c.getAttribute('data-color'))).toEqual([
      'red', 'yellow', 'green', 'blue', 'white',
    ]);
  });

  it('passes the matching status snapshot (by color) into each DeviceCard', () => {
    hubConfigState.loading = false;
    hubConfigState.config = {
      devices: [
        { color: 'red',    class: 'private', volume: { default: 50, min: 0, max: 75 } },
        { color: 'white',  class: 'public',  volume: { default: 40, min: 0, max: 70 } },
      ],
      scheduled: [],
    };
    const redStatus = { color: 'red', bt_connected: true, volume: 45, paused: false };
    hubStatusMap.set('red', redStatus);

    renderPage();

    const redCallProps = deviceCardCalls.find(p => p.slot.color === 'red');
    const whiteCallProps = deviceCardCalls.find(p => p.slot.color === 'white');
    expect(redCallProps.status).toBe(redStatus);
    expect(whiteCallProps.status).toBeUndefined();
  });

  it('filters scheduled fires per-device by target color before passing to DeviceCard', () => {
    hubConfigState.loading = false;
    hubConfigState.config = {
      devices: [
        { color: 'red',   class: 'private', volume: { default: 50, min: 0, max: 75 } },
        { color: 'white', class: 'public',  volume: { default: 40, min: 0, max: 70 } },
      ],
      scheduled: [
        { id: 'f1', target: 'red',   time: '07:00', days: 'all', queue: 'plex:1' },
        { id: 'f2', target: 'red',   time: '08:00', days: 'all', queue: 'plex:2' },
        { id: 'f3', target: 'white', time: '09:00', days: 'all', queue: 'plex:3' },
      ],
    };

    renderPage();

    const redCallProps = deviceCardCalls.find(p => p.slot.color === 'red');
    const whiteCallProps = deviceCardCalls.find(p => p.slot.color === 'white');
    expect(redCallProps.scheduledFires.map(f => f.id)).toEqual(['f1', 'f2']);
    expect(whiteCallProps.scheduledFires.map(f => f.id)).toEqual(['f3']);
  });

  it('renders StalenessBanner when fetchedAt is null', () => {
    hubStatusState.fetchedAt = null;
    hubConfigState.loading = false;
    hubConfigState.config = {
      devices: [
        { color: 'red', class: 'private', volume: { default: 50, min: 0, max: 75 } },
      ],
      scheduled: [],
    };
    renderPage();
    expect(screen.getByText(/live updates paused/i)).toBeTruthy();
  });

  it('forwards the mutations object to every DeviceCard', () => {
    hubConfigState.loading = false;
    hubConfigState.config = {
      devices: [
        { color: 'red', class: 'private', volume: { default: 50, min: 0, max: 75 } },
      ],
      scheduled: [],
    };

    renderPage();

    const redCallProps = deviceCardCalls.find(p => p.slot.color === 'red');
    expect(redCallProps.mutations).toBe(hubMutations);
  });
});
