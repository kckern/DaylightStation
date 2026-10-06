// PLACE.4a/AC5 (RQ-PLACE-10): either of two screens playing the same thing
// offers "Line up with <other>", seeking it to the other's reported spot.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { PeekContext } from '../peek/PeekContext.js';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import { createFleetStore } from '../fleet/fleetStore.js';
import { createLocalSessionController } from '../session/LocalSessionController.js';
import { LineUpOffer, lineUpPeers, reportedSpot } from './LineUpOffer.jsx';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

const snap = (contentId, position, state = 'playing') => ({
  sessionId: `s-${contentId}`, state, position,
  currentItem: { contentId, title: 'Hospital', duration: 420 },
  queue: { items: [], currentIndex: -1, upNextCount: 0 }, config: { playbackRate: 1 },
});

describe('lineUpPeers', () => {
  it('lists other fresh screens playing the same item, with their spot carried forward', () => {
    const now = Date.parse('2026-10-03T10:00:10Z');
    const entries = new Map([
      ['kitchen', { snapshot: snap('plex:1', 100), receivedAt: '2026-10-03T10:00:05Z' }],
      ['den', { snapshot: snap('plex:2', 50), receivedAt: '2026-10-03T10:00:05Z' }],
      ['stale', { snapshot: snap('plex:1', 10), receivedAt: '2026-10-03T10:00:05Z', isStale: true }],
    ]);
    const devices = [{ id: 'kitchen', name: 'Kitchen' }];
    expect(lineUpPeers({ selfId: 'living', contentId: 'plex:1', entries, devices, now })).toEqual([
      { id: 'kitchen', name: 'Kitchen', spot: 105 },
    ]);
    expect(reportedSpot(snap('plex:1', 30, 'paused'), '2026-10-03T10:00:05Z', now)).toBe(30);
  });
});

describe('LineUpOffer', () => {
  it('on a screen\'s Remote: lines it up with the other screen, and says so', async () => {
    const store = createFleetStore();
    store.receive({ deviceId: 'living', snapshot: snap('plex:1', 40), ts: new Date().toISOString() });
    store.receive({ deviceId: 'kitchen', snapshot: snap('plex:1', 100), ts: new Date().toISOString() });
    const seekAbs = vi.fn(async () => ({ ok: true }));
    const remote = {
      getSnapshot: () => store.getEntry('living').snapshot,
      subscribe: () => () => {},
      transport: { seekAbs },
      capabilities: { seekable: true },
    };
    const recordLocal = vi.fn();
    const local = createLocalSessionController({ clientId: 'me', sessionControls: { storage: null } });
    render(
      <MantineProvider>
        <FleetContext.Provider value={{ devices: [{ id: 'kitchen', name: 'Kitchen' }, { id: 'living', name: 'Living Room TV' }], store, identity: { deviceId: 'browser:me' } }}>
          <LocalSessionContext.Provider value={{ controller: local }}>
            <PeekContext.Provider value={{ getController: () => remote }}>
              <DispatchContext.Provider value={{ recordLocal }}>
                <LineUpOffer target={{ deviceId: 'living' }} targetName="Living Room TV" />
              </DispatchContext.Provider>
            </PeekContext.Provider>
          </LocalSessionContext.Provider>
        </FleetContext.Provider>
      </MantineProvider>,
    );
    expect(screen.getByTestId('line-up-kitchen')).toHaveTextContent('Line up with Kitchen');
    expect(screen.queryByTestId('line-up-living')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId('line-up-kitchen')); });
    expect(seekAbs).toHaveBeenCalledTimes(1);
    expect(seekAbs.mock.calls[0][0]).toBeGreaterThanOrEqual(100);
    expect(seekAbs.mock.calls[0][0]).toBeLessThan(102);
    await waitFor(() => expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'lineUp', phase: 'confirmed', targetId: 'living', item: expect.objectContaining({ title: 'Hospital with Kitchen' }),
    })));
  });

  it('offers nothing when no other screen plays the same item', () => {
    const store = createFleetStore();
    store.receive({ deviceId: 'living', snapshot: snap('plex:1', 40), ts: new Date().toISOString() });
    const remote = { getSnapshot: () => store.getEntry('living').snapshot, subscribe: () => () => {}, transport: {}, capabilities: { seekable: true } };
    const { container } = render(
      <MantineProvider>
        <FleetContext.Provider value={{ devices: [], store, identity: { deviceId: 'browser:me' } }}>
          <PeekContext.Provider value={{ getController: () => remote }}>
            <LineUpOffer target={{ deviceId: 'living' }} />
          </PeekContext.Provider>
        </FleetContext.Provider>
      </MantineProvider>,
    );
    expect(container.querySelector('[data-testid="line-up-offer"]')).toBeNull();
  });
});
