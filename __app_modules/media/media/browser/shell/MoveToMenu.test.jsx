// PLACE.9a: from another screen's controls, Move to… lists other screens,
// including this device, and reports one outcome.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { LocalSessionContext } from "../session/LocalSessionContext.js";
import { DispatchContext } from "../cast/DispatchProvider.jsx";
import { createFleetStore } from "../fleet/fleetStore.js";
import { createLocalSessionController } from "../session/LocalSessionController.js";

const api = vi.fn(async () => ({ ok: true }));
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...args) => api(...args) }));
vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import { MoveToMenu, moveDestinations } from "./MoveToMenu.jsx";

const devices = [
  { id: 'kitchen', name: 'Kitchen TV', content_control: {} },
  { id: 'den', name: 'Den TV', location: 'Den', fleet: true, content_control: { type: 'websocket' } },
  { id: 'browser:x', name: 'Phone' },
  { id: 'piano', name: 'Piano' },
];

describe('MoveToMenu', () => {
  it('offers this device and every other content screen, never the source or a browser', () => {
    expect(moveDestinations(devices, 'kitchen').map((d) => d.id)).toEqual(['den']);
  });

  it('a film never moves to a headset or a display with no receiver; the usual screen comes first, then by name', () => {
    const house = [
      { id: 'zeta-tv', name: 'Zeta TV', content_control: {} },
      { id: 'garage-tv', name: 'Garage Gym TV', fleet: true },
      { id: 'speaker-red', name: 'Red Headset', type: 'speaker', fleet: true },
      { id: 'alpha-tv', name: 'Alpha TV', content_control: {} },
      { id: 'office-tv', name: 'Office Screen', content_control: {} },
    ];
    expect(moveDestinations(house, null, { kind: 'video', preferredIds: ['office-tv'] }).map((d) => d.id))
      .toEqual(['office-tv', 'alpha-tv', 'zeta-tv']);
    expect(moveDestinations(house, null, { kind: 'audio' }).map((d) => d.id))
      .toEqual(['alpha-tv', 'office-tv', 'speaker-red', 'zeta-tv']); // by name: Red Headset
  });

  it('moves the screen\'s playback here and hands navigation back to Remote', async () => {
    const store = createFleetStore();
    store.receive({ deviceId: 'kitchen', ts: new Date().toISOString(), snapshot: {
      sessionId: 's', state: 'paused', position: 61,
      currentItem: { contentId: 'plex:1', title: 'Hospital', duration: 420, queueItemId: 'q1', format: 'video' },
      queue: { items: [{ queueItemId: 'q1', contentId: 'plex:1', title: 'Hospital', format: 'video' }], currentIndex: 0, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'kitchen', updatedAt: new Date().toISOString(), playbackOwner: { ownerInstanceId: 'o', playbackRevision: 1, queueRevision: 1, sessionId: 's', contentId: 'plex:1', queueItemId: 'q1' } },
    } });
    const local = createLocalSessionController({ clientId: 'me', sessionControls: { storage: null } });
    const recordLocal = vi.fn(() => 'a1');
    const resolveLocal = vi.fn();
    const navigateAfterMove = vi.fn();
    render(
      <MantineProvider>
        <FleetContext.Provider value={{ devices, store, identity: { deviceId: 'browser:me' } }}>
          <LocalSessionContext.Provider value={{ controller: local }}>
            <DispatchContext.Provider value={{ recordLocal, resolveLocal }}>
              <MoveToMenu sourceId="kitchen" title="Hospital" captureLocalMoveNavigation={() => navigateAfterMove} />
            </DispatchContext.Provider>
          </LocalSessionContext.Provider>
        </FleetContext.Provider>
      </MantineProvider>,
    );
    fireEvent.click(screen.getByTestId('peek-move-to'));
    expect(await screen.findByTestId('move-to-den')).toHaveTextContent('Den TV · Den');
    await act(async () => { fireEvent.click(screen.getByTestId('move-to-local')); });
    expect(resolveLocal).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
    const decoder = { paused: true, seeking: false, ended: false, readyState: 4, currentTime: 61, duration: 420 };
    local.setPlayerHandle({ getMediaElement: () => decoder, getMountedContentId: () => 'plex:1', getMountedMediaGeneration: () => 1 });
    local.portability.getNativeObservation();
    await act(async () => { local.onNativeObservationEvent(decoder, 'loadeddata'); });
    await waitFor(() => expect(resolveLocal).toHaveBeenCalled());
    expect(resolveLocal.mock.calls[0]).toEqual(['a1', { phase: 'confirmed' }]);
    expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'move', phase: 'running', targetId: 'local', item: { title: 'Hospital' }, command: expect.objectContaining({ sourceId: 'kitchen' }) }));
    expect(local.getSnapshot().currentItem.contentId).toBe('plex:1');
    expect(api).toHaveBeenCalledWith('api/v1/device/kitchen/session/claim', expect.objectContaining({ origin: { kind: 'device', id: 'browser:me' } }), 'POST');
    expect(navigateAfterMove).toHaveBeenCalledOnce();
  });
});
