import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

const subscribeFn = vi.fn();
const onStatusChangeFn = vi.fn();
vi.mock('../../../services/WebSocketService.js', () => ({
  wsService: {
    send: vi.fn(),
    subscribe: (...args) => subscribeFn(...args),
    onStatusChange: (...args) => onStatusChangeFn(...args),
  },
  default: { send: vi.fn(), subscribe: (...args) => subscribeFn(...args), onStatusChange: (...args) => onStatusChangeFn(...args) },
}));

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...args) => apiMock(...args),
}));

import { FleetProvider, useFleetContext } from './FleetProvider.jsx';

function Probe() {
  const { devices, byDevice } = useFleetContext();
  const ids = devices.map((d) => d.id).join(',');
  const states = [...byDevice.entries()].map(([id, e]) => `${id}:${e.snapshot?.state ?? '?'}`).join(',');
  return <div>devices={ids};states={states}</div>;
}

let capturedFilter = null;
let capturedCallback = null;
beforeEach(() => {
  apiMock.mockReset();
  subscribeFn.mockReset().mockImplementation((filter, cb) => {
    capturedFilter = filter;
    capturedCallback = cb;
    return () => {};
  });
  onStatusChangeFn.mockReset().mockReturnValue(() => {});
});

describe('FleetProvider', () => {
  it('loads devices from /api/v1/device/config and subscribes to device-state:*', async () => {
    apiMock.mockResolvedValueOnce({ devices: { 'lr': { type: 'shield-tv', content_control: { x: 1 } } } });
    render(<FleetProvider><Probe /></FleetProvider>);
    await waitFor(() => expect(screen.getByText(/devices=lr;/)).toBeInTheDocument());
    expect(typeof capturedFilter).toBe('function');
    expect(capturedFilter({ topic: 'device-state:lr' })).toBe(true);
    expect(capturedFilter({ topic: 'device-state:other-id' })).toBe(true);
    expect(capturedFilter({ topic: 'playback_state' })).toBe(false);
    expect(capturedFilter({ topic: 'device-ack:lr' })).toBe(false);
  });

  it('routes incoming device-state broadcasts into byDevice', async () => {
    apiMock.mockResolvedValueOnce({ devices: { 'lr': { type: 'shield-tv', content_control: { x: 1 } } } });
    render(<FleetProvider><Probe /></FleetProvider>);
    await waitFor(() => expect(capturedCallback).toBeTruthy());

    act(() => {
      capturedCallback({
        topic: 'device-state:lr',
        deviceId: 'lr',
        reason: 'heartbeat',
        snapshot: {
          sessionId: 's', state: 'playing', currentItem: null, position: 0,
          queue: { items: [], currentIndex: -1, upNextCount: 0 },
          config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
          meta: { ownerId: 'lr', updatedAt: 't' },
        },
        ts: '2026-04-18T00:00:00Z',
      });
    });
    await waitFor(() => expect(screen.getByText(/lr:playing/)).toBeInTheDocument());
  });

  it('ignores malformed broadcasts (missing deviceId or snapshot)', async () => {
    apiMock.mockResolvedValueOnce({ devices: { 'lr': { type: 'shield-tv', content_control: { x: 1 } } } });
    render(<FleetProvider><Probe /></FleetProvider>);
    await waitFor(() => expect(capturedCallback).toBeTruthy());

    act(() => {
      capturedCallback({ topic: 'device-state:lr' }); // no deviceId, no snapshot
      capturedCallback({ topic: 'device-state:', deviceId: '', snapshot: {} }); // empty id
    });
    await waitFor(() => expect(screen.getByText(/states=$|states=[^:]/)).toBeInTheDocument());
  });

  it('marks all devices stale on WS disconnect status', async () => {
    let statusListener;
    onStatusChangeFn.mockImplementation((cb) => { statusListener = cb; return () => {}; });
    apiMock.mockResolvedValueOnce({ devices: { 'lr': { type: 'shield-tv', content_control: { x: 1 } } } });

    function StaleProbe() {
      const { byDevice } = useFleetContext();
      const entry = byDevice.get('lr');
      return <div>stale={String(entry?.isStale ?? 'none')}</div>;
    }

    render(<FleetProvider><StaleProbe /></FleetProvider>);
    await waitFor(() => expect(capturedCallback).toBeTruthy());

    act(() => {
      capturedCallback({
        topic: 'device-state:lr', deviceId: 'lr', reason: 'heartbeat',
        snapshot: {
          sessionId: 's', state: 'idle', currentItem: null, position: 0,
          queue: { items: [], currentIndex: -1, upNextCount: 0 },
          config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
          meta: { ownerId: 'lr', updatedAt: 't' },
        },
        ts: 't',
      });
    });
    await waitFor(() => expect(screen.getByText(/stale=false/)).toBeInTheDocument());

    act(() => { statusListener?.({ connected: false }); });
    await waitFor(() => expect(screen.getByText(/stale=true/)).toBeInTheDocument());
  });
});
