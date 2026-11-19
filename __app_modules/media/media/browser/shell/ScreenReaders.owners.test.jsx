import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { createFleetStore } from '../fleet/fleetStore.js';
import { CastTargetContext } from '../cast/CastTargetProvider.jsx';
import { GlobalAimLabel } from '../cast/AimLabel.jsx';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { createPositionChannel } from '../session/positionChannel.js';
import { ScreenHandle } from './ScreenHandle.jsx';
import { SeekBar } from './SeekBar.jsx';

vi.mock('./NavProvider.jsx', () => ({ useNav: () => ({ view: 'home' }) }));

it('follows only the newly selected screen and its current playback origin', () => {
  const store = createFleetStore();
  const attached = new Map();
  const subscribeDevice = store.subscribeDevice;
  vi.spyOn(store, 'subscribeDevice').mockImplementation((id, listener) => {
    const release = vi.fn(subscribeDevice(id, listener));
    attached.set(id, [...(attached.get(id) || []), release]);
    return release;
  });
  const devices = ['office', 'den'].map(id => ({ id, name: id }));
  const report = (deviceId, title, origin) => store.receive({
    deviceId, ts: new Date().toISOString(), snapshot: {
      state: 'playing', currentItem: { contentId: title, title },
      meta: { origin: { kind: 'routine', name: origin } },
    },
  });
  report('office', 'First film', 'Morning');
  report('den', 'Second film', 'Evening');
  const tree = id => <FleetContext.Provider value={{ store, devices }}>
    <CastTargetContext.Provider value={{ targetIds: [id] }}><GlobalAimLabel /><ScreenHandle /></CastTargetContext.Provider>
  </FleetContext.Provider>;
  const { rerender, unmount } = render(tree('office'));
  expect(screen.getByTestId('screen-handle-open')).toHaveAccessibleName(/First film/);
  rerender(tree('den'));
  expect(attached.get('office').length).toBeGreaterThan(0);
  for (const release of attached.get('office')) expect(release).toHaveBeenCalledOnce();
  act(() => report('office', 'Unrelated film', 'Wrong'));
  expect(screen.getByTestId('screen-handle-open')).toHaveAccessibleName(/Second film/);
  expect(screen.getByTestId('aim-busy-origin')).toHaveTextContent('Evening routine');
  act(() => report('den', 'Third film', 'Weekend'));
  expect(screen.getByTestId('screen-handle-open')).toHaveAccessibleName(/Third film/);
  expect(screen.getByTestId('aim-busy-origin')).toHaveTextContent('Weekend routine');
  unmount();
  for (const release of attached.get('den')) expect(release).toHaveBeenCalledOnce();
});

it('moves the seek bar clock to the replacement controller and ignores the old clock', () => {
  const snapshot = { state: 'playing', currentItem: { duration: 300 }, position: 0 };
  const controller = () => ({ getSnapshot: () => snapshot, subscribe: () => () => {},
    position: createPositionChannel(), capabilities: { seekable: true } });
  const first = controller();
  const second = controller();
  const subscribe = first.position.subscribe;
  const releaseFirst = vi.fn();
  vi.spyOn(first.position, 'subscribe').mockImplementation(listener => {
    const unsubscribe = subscribe(listener);
    return () => { unsubscribe(); releaseFirst(); };
  });
  first.position.set(45);
  second.position.set(60);
  const tree = ctl => <LocalSessionContext.Provider value={{ controller: ctl }}><SeekBar target="local" /></LocalSessionContext.Provider>;
  const { rerender } = render(tree(first));
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '45');
  rerender(tree(second));
  expect(releaseFirst).toHaveBeenCalledOnce();
  act(() => first.position.set(200));
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '60');
  act(() => second.position.set(75));
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '75');
});
