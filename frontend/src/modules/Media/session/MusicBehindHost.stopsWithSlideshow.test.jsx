import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

// Music behind a local slideshow ends when the photos give way to something
// with its own sound, or to nothing — unless the person chose Keep.
const session = { snapshot: { state: 'playing', currentItem: { contentId: 'immich:1', format: 'image' } } };
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({ snapshot: session.snapshot, controller: { getSnapshot: () => session.snapshot } }),
}));
vi.mock('../../Player/components/MusicBehindLayer.jsx', () => ({
  MusicBehindLayer: () => <div data-testid="music-layer" />,
}));

import { MusicBehindHost } from './MusicBehindHost.jsx';
import { LocalSessionContext } from './LocalSessionContext.js';
import { getLocalPlayerFeatures, __resetLocalPlayerFeatures } from './localPlayerFeatures.js';

const ui = () => (
  <LocalSessionContext.Provider value={{ controller: { getSnapshot: () => session.snapshot } }}>
    <MusicBehindHost />
  </LocalSessionContext.Provider>
);

async function startMusic(features) {
  await act(async () => { await features.musicBehind('start', { contentId: 'plex:5', title: 'Faith' }); });
  expect(features.getState().musicBehind).not.toBeNull();
}

beforeEach(() => {
  __resetLocalPlayerFeatures();
  session.snapshot = { state: 'playing', currentItem: { contentId: 'immich:1', format: 'image' } };
});

describe('local music behind follows the slideshow', () => {
  it('stops when a video replaces the photos', async () => {
    const features = getLocalPlayerFeatures();
    const { rerender, queryByTestId } = render(ui());
    await startMusic(features);
    expect(queryByTestId('music-layer')).not.toBeNull();
    session.snapshot = { state: 'playing', currentItem: { contentId: 'plex:1', format: 'dash_video' } };
    rerender(ui());
    expect(queryByTestId('music-layer')).toBeNull();
    expect(features.getState().musicBehind).toBeNull();
  });

  it('stops when the slideshow stops, unless Keep was chosen', async () => {
    const features = getLocalPlayerFeatures();
    const { rerender, queryByTestId } = render(ui());
    await startMusic(features);
    session.snapshot = { state: 'ready', currentItem: null };
    rerender(ui());
    expect(queryByTestId('music-layer')).toBeNull();

    session.snapshot = { state: 'playing', currentItem: { contentId: 'immich:1', format: 'image' } };
    rerender(ui());
    await startMusic(features);
    features.keepMusicAfterStop();
    session.snapshot = { state: 'ready', currentItem: null };
    rerender(ui());
    expect(queryByTestId('music-layer')).not.toBeNull();
    // …and a kept music does not play under the next video.
    session.snapshot = { state: 'playing', currentItem: { contentId: 'plex:1', format: 'dash_video' } };
    rerender(ui());
    expect(queryByTestId('music-layer')).toBeNull();
  });

  it('a load between two photos does not stop it', async () => {
    const features = getLocalPlayerFeatures();
    const { rerender, queryByTestId } = render(ui());
    await startMusic(features);
    session.snapshot = { state: 'loading', currentItem: null };
    rerender(ui());
    expect(queryByTestId('music-layer')).not.toBeNull();
  });
});
