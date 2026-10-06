import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

// Music behind a slideshow on a screen follows the photos (no double audio):
// a video replacing them stops it; a person's Stop from another device that
// chose Keep leaves it; the TV remote / a routine stops it too.
const bus = new Map();
vi.mock('../input/ActionBus.js', () => ({
  getActionBus: () => ({
    subscribe: (t, fn) => { bus.set(t, fn); return () => bus.delete(t); },
    capture: () => () => {},
    emit: vi.fn(),
  }),
}));
vi.mock('../../modules/Player/lib/queueOpRegistry.js', () => ({ getPlayerQueueOpRegistry: () => ({ dispatch: vi.fn() }) }));
vi.mock('../../modules/Player/lib/trackPolicy.js', () => ({
  registerTrackOwner: () => () => {}, createTrackPreferenceStore: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('../publishers/playerSessionRegistry.js', () => ({ getPlayerSessionRegistry: () => ({ getCurrent: () => null }) }));
vi.mock('../../modules/Player/Player.jsx', () => ({ default: () => null }));
vi.mock('../../modules/CameraFeed/CameraOverlay.jsx', () => ({ default: () => null }));
vi.mock('../../modules/Player/components/MusicBehindLayer.jsx', () => ({
  MusicBehindLayer: () => <div data-testid="music-layer" />,
}));
vi.mock('./ScreenSessionControlsHost.jsx', () => ({ requestRestore: vi.fn() }));

import { ScreenPlayerFeaturesHost } from './ScreenPlayerFeaturesHost.jsx';
import { createScreenPlayerFeatures } from './screenPlayerFeatures.js';

const photo = { contentId: 'immich:1', format: 'image' };
let snap;
let listener;
const source = {
  getBareSnapshot: () => snap,
  getSnapshot: () => snap,
  getActionOwner: () => null,
  subscribe: (l) => { listener = l; return () => {}; },
};
const change = (next) => act(() => { snap = next; listener.onChange(); });

async function setup() {
  const features = createScreenPlayerFeatures({ ownerId: 'tv' });
  const view = render(<ScreenPlayerFeaturesHost features={features} source={source} />);
  const result = await act(async () => features.handleSession('music-behind', { op: 'start', contentId: 'plex:5', title: 'Faith' }));
  expect(result.ok).toBe(true);
  expect(view.queryByTestId('music-layer')).not.toBeNull();
  return { features, view };
}

beforeEach(() => { bus.clear(); snap = { state: 'playing', currentItem: photo }; });

describe('screen music behind follows the slideshow', () => {
  it('stops when a video replaces the photos', async () => {
    const { view } = await setup();
    await change({ state: 'playing', currentItem: { contentId: 'plex:1', format: 'dash_video' } });
    expect(view.queryByTestId('music-layer')).toBeNull();
  });

  it('a device-origin Stop keeps it over the empty screen; the next video still ends it', async () => {
    const { view } = await setup();
    act(() => bus.get('media:playback')({ command: 'stop', origin: { kind: 'device', id: 'phone' } }));
    await change({ state: 'ready', currentItem: null });
    expect(view.queryByTestId('music-layer')).not.toBeNull();
    await change({ state: 'playing', currentItem: { contentId: 'plex:1', format: 'dash_video' } });
    expect(view.queryByTestId('music-layer')).toBeNull();
  });

  it('a routine\'s Stop stops it too', async () => {
    const { view } = await setup();
    act(() => bus.get('media:playback')({ command: 'stop', origin: { kind: 'routine', name: 'Bedtime' } }));
    expect(view.queryByTestId('music-layer')).toBeNull();
  });
});
