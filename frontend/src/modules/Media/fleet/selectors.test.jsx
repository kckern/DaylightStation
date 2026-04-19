import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const subscribeFn = vi.fn();
vi.mock('../../../services/WebSocketService.js', () => ({
  wsService: {
    send: vi.fn(),
    subscribe: (...args) => subscribeFn(...args),
    onStatusChange: vi.fn(() => () => {}),
  },
  default: { send: vi.fn(), subscribe: (...args) => subscribeFn(...args), onStatusChange: vi.fn(() => () => {}) },
}));
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => ({
    devices: {
      'lr': { type: 'shield-tv', content_control: { x: 1 }, name: 'Living Room' },
      'ot': { type: 'linux-pc', content_control: { x: 1 }, name: 'Office' },
    },
  })),
}));

import { FleetProvider } from './FleetProvider.jsx';
import { useDevice } from './useDevice.js';
import { useFleetSummary } from './useFleetSummary.js';

let capturedCallback = null;
beforeEach(() => {
  subscribeFn.mockReset().mockImplementation((_f, cb) => { capturedCallback = cb; return () => {}; });
});

function DeviceProbe({ id }) {
  const d = useDevice(id);
  if (!d) return <div>none</div>;
  return <div>name={d.config.name};state={d.snapshot?.state ?? '?'};stale={String(d.isStale)}</div>;
}
function SummaryProbe() {
  const s = useFleetSummary();
  return <div>total={s.total};online={s.online};offline={s.offline}</div>;
}

describe('useDevice / useFleetSummary', () => {
  it('useDevice returns config + snapshot + isStale for a known id', async () => {
    render(<FleetProvider><DeviceProbe id="lr" /></FleetProvider>);
    await waitFor(() => expect(screen.getByText(/name=Living Room/)).toBeInTheDocument());
    expect(screen.getByText(/state=\?/)).toBeInTheDocument();

    act(() => {
      capturedCallback({
        topic: 'device-state:lr', deviceId: 'lr', reason: 'change',
        snapshot: {
          sessionId: 's', state: 'paused', currentItem: null, position: 0,
          queue: { items: [], currentIndex: -1, upNextCount: 0 },
          config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
          meta: { ownerId: 'lr', updatedAt: 't' },
        },
        ts: 't',
      });
    });
    await waitFor(() => expect(screen.getByText(/state=paused/)).toBeInTheDocument());
  });

  it('useDevice returns null for an unknown id', async () => {
    render(<FleetProvider><DeviceProbe id="ghost" /></FleetProvider>);
    await waitFor(() => expect(screen.getByText(/none/)).toBeInTheDocument());
  });

  it('useFleetSummary reports total / online / offline counts', async () => {
    render(<FleetProvider><SummaryProbe /></FleetProvider>);
    await waitFor(() => expect(screen.getByText(/total=2/)).toBeInTheDocument());
    expect(screen.getByText(/online=0/)).toBeInTheDocument();

    act(() => {
      capturedCallback({
        topic: 'device-state:lr', deviceId: 'lr', reason: 'heartbeat',
        snapshot: {
          sessionId: 's', state: 'playing', currentItem: null, position: 0,
          queue: { items: [], currentIndex: -1, upNextCount: 0 },
          config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
          meta: { ownerId: 'lr', updatedAt: 't' },
        },
        ts: 't',
      });
    });
    await waitFor(() => expect(screen.getByText(/online=1/)).toBeInTheDocument());

    act(() => {
      capturedCallback({ topic: 'device-state:ot', deviceId: 'ot', reason: 'offline', snapshot: null, ts: 't' });
    });
    await waitFor(() => expect(screen.getByText(/offline=1/)).toBeInTheDocument());
  });
});
