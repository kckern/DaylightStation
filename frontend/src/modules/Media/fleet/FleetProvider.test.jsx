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
  const { devices, store } = useContext(FleetContext);
  return <output>{JSON.stringify({ devices, entries: [...store.getAll().entries()] })}</output>;
}

describe('FleetProvider browser session feed', () => {
  it('keeps one stable browser row for repeated sender state and removes its shared-topic subscription on unmount', () => {
    const { unmount } = render(<FleetProvider><Probe /></FleetProvider>);
    const feed = playbackSubscribers.find(({ topic }) => topic === 'playback_state');
    expect(feed).toBeTruthy();

    act(() => {
      feed.callback({ topic: 'playback_state', clientId: 'sender-browser', displayName: 'Sender browser', identity: { clientId: 'sender-browser', deviceId: 'browser:sender-browser', name: 'Sender browser', room: 'Kitchen' }, deviceId: 'browser:sender-browser', ownerId: 'sender-browser', revision: 1, origin: { kind: 'routine', name: 'Breakfast' }, sessionId: 's1', state: 'playing', currentItem: { contentId: 'plex:55854', title: 'Arrival' }, queue: { items: [{ queueItemId: 'q1', contentId: 'plex:55854' }], currentIndex: 0 }, position: 12, config: {}, connected: true, lastHeardAt: '2026-09-22T12:00:00.000Z' });
      feed.callback({ topic: 'playback_state', clientId: 'sender-browser', displayName: 'Sender browser', identity: { clientId: 'sender-browser', deviceId: 'browser:sender-browser', name: 'Sender browser', room: 'Kitchen' }, deviceId: 'browser:sender-browser', ownerId: 'sender-browser', revision: 2, origin: { kind: 'device', id: 'browser:sender-browser' }, sessionId: 's1', state: 'paused', currentItem: { contentId: 'plex:55854', title: 'Arrival' }, queue: { items: [{ queueItemId: 'q1', contentId: 'plex:55854' }], currentIndex: 0 }, position: 14, config: {}, connected: true, lastHeardAt: '2026-09-22T12:00:01.000Z' });
    });

    const result = JSON.parse(screen.getByRole('status').textContent);
    expect(result.devices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'browser:sender-browser', name: 'Sender browser', isLocal: false }),
    ]));
    expect(result.devices.filter(({ id }) => id === 'browser:sender-browser')).toHaveLength(1);
    expect(result.devices.find(({ id }) => id === 'browser:sender-browser')).toMatchObject({ room: 'Kitchen' });
    expect(result.entries).toContainEqual(['browser:sender-browser', expect.objectContaining({
      identity: expect.objectContaining({ deviceId: 'browser:sender-browser' }),
      connected: true,
      snapshot: expect.objectContaining({ queue: expect.objectContaining({ items: [expect.objectContaining({ queueItemId: 'q1' })] }), meta: expect.objectContaining({ revision: 2, origin: { kind: 'device', id: 'browser:sender-browser' } }) }),
    })]);

    // This provider consumes the one authoritative playback publication path;
    // it must not synthesize a second local browser row from controller state.
    expect(result.devices.some(({ id }) => id === 'browser:observer-browser')).toBe(false);

    unmount();
    expect(playbackUnsubscribes).toContainEqual(expect.any(Function));
    expect(playbackUnsubscribes.at(-1)).toHaveBeenCalledTimes(1);
  });
});
