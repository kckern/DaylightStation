import React, { useContext } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const playbackSubscribers = [];
const playbackUnsubscribes = [];
const observerSnapshot = { sessionId: 'observer-session', state: 'idle', currentItem: null };

vi.mock('./useDevices.js', () => ({
  useDevices: () => ({ devices: [], loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../identity/useClientIdentity.js', () => ({
  useClientIdentity: () => ({ clientId: 'observer-browser', displayName: 'Observer browser' }),
}));
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({ controller: {}, snapshot: observerSnapshot }),
}));
vi.mock('../net/ws.js', () => ({
  topics: { playbackState: 'playback_state' },
  subscribeTopic: vi.fn((topic, callback) => {
    playbackSubscribers.push({ topic, callback });
    const unsubscribe = vi.fn();
    playbackUnsubscribes.push(unsubscribe);
    return unsubscribe;
  }),
  subscribeTopicKind: vi.fn(() => vi.fn()),
  onStatus: vi.fn(() => vi.fn()),
}));
vi.mock('../logging/mediaLog.js', () => ({ default: new Proxy({}, { get: () => vi.fn() }) }));

import { FleetContext, FleetProvider } from './FleetProvider.jsx';

function Probe() {
  const { devices } = useContext(FleetContext);
  return <output>{JSON.stringify(devices)}</output>;
}

describe('FleetProvider browser session feed', () => {
  it('keeps one stable browser row for repeated sender state and removes its shared-topic subscription on unmount', () => {
    const { unmount } = render(<FleetProvider><Probe /></FleetProvider>);
    const feed = playbackSubscribers.find(({ topic }) => topic === 'playback_state');
    expect(feed).toBeTruthy();

    act(() => {
      feed.callback({ topic: 'playback_state', clientId: 'sender-browser', displayName: 'Sender browser', sessionId: 's1', state: 'playing', currentItem: { contentId: 'plex:55854', title: 'Arrival' }, position: 12, config: {} });
      feed.callback({ topic: 'playback_state', clientId: 'sender-browser', displayName: 'Sender browser', sessionId: 's1', state: 'paused', currentItem: { contentId: 'plex:55854', title: 'Arrival' }, position: 14, config: {} });
    });

    expect(JSON.parse(screen.getByRole('status').textContent)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'browser:sender-browser', name: 'Sender browser', isLocal: false }),
    ]));
    expect(JSON.parse(screen.getByRole('status').textContent).filter(({ id }) => id === 'browser:sender-browser')).toHaveLength(1);

    unmount();
    expect(playbackUnsubscribes).toContainEqual(expect.any(Function));
    expect(playbackUnsubscribes.at(-1)).toHaveBeenCalledTimes(1);
  });
});
