import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const subscribeFn = vi.fn();
vi.mock('../../../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn(), subscribe: (...a) => subscribeFn(...a), onStatusChange: vi.fn(() => () => {}) },
  default: { send: vi.fn(), subscribe: (...a) => subscribeFn(...a), onStatusChange: vi.fn(() => () => {}) },
}));

const apiMock = vi.fn(async () => ({ ok: true }));
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...a) => apiMock(...a),
}));

let fleetCtx = {
  devices: [{ id: 'lr', name: 'Living Room' }],
  byDevice: new Map([['lr', { snapshot: { state: 'playing', sessionId: 'remote' }, isStale: false, offline: false }]]),
  loading: false, error: null, refresh: vi.fn(),
};
vi.mock('../fleet/FleetProvider.jsx', () => ({
  useFleetContext: vi.fn(() => fleetCtx),
}));

import { PeekProvider } from './PeekProvider.jsx';
import { usePeek } from './usePeek.js';

function Probe() {
  const { activePeeks, enterPeek, exitPeek } = usePeek();
  const ids = [...activePeeks.keys()].join(',');
  return (
    <div>
      <span data-testid="peeks">{ids}</span>
      <button data-testid="enter" onClick={() => enterPeek('lr')}>enter</button>
      <button data-testid="exit" onClick={() => exitPeek('lr')}>exit</button>
    </div>
  );
}

let capturedFilter = null;
beforeEach(() => {
  apiMock.mockReset().mockResolvedValue({ ok: true });
  subscribeFn.mockReset().mockImplementation((filter) => { capturedFilter = filter; return () => {}; });
});

describe('PeekProvider', () => {
  it('subscribes to device-ack:* on mount', () => {
    render(<PeekProvider><Probe /></PeekProvider>);
    expect(typeof capturedFilter).toBe('function');
    expect(capturedFilter({ topic: 'device-ack:lr' })).toBe(true);
    expect(capturedFilter({ topic: 'device-state:lr' })).toBe(false);
  });

  it('enterPeek adds a controller to activePeeks', () => {
    render(<PeekProvider><Probe /></PeekProvider>);
    act(() => { screen.getByTestId('enter').click(); });
    expect(screen.getByTestId('peeks')).toHaveTextContent('lr');
  });

  it('exitPeek removes the controller', () => {
    render(<PeekProvider><Probe /></PeekProvider>);
    act(() => { screen.getByTestId('enter').click(); });
    act(() => { screen.getByTestId('exit').click(); });
    expect(screen.getByTestId('peeks')).toHaveTextContent('');
  });

  it('entering an unknown device does nothing', () => {
    render(<PeekProvider><Probe /></PeekProvider>);
    expect(screen.getByTestId('peeks')).toHaveTextContent('');
  });
});
