import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const frames = [];

vi.mock('./components/SinglePlayer.jsx', () => ({
  SinglePlayer: (props) => {
    frames.push(props);
    return <div data-testid="single-player" data-content-id={props.contentId} />;
  },
}));

vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.reject(new Error('offline in test'))),
}));

import Player from './Player.jsx';

const latest = () => frames.at(-1);

beforeEach(() => { frames.length = 0; });
afterEach(() => cleanup());

describe('Player slideshow keyboard navigation', () => {
  it('uses left/right to move backward/forward across image and video items', async () => {
    render(<Player play={[
      { contentId: 'immich:photo', format: 'image', mediaType: 'image', slideshow: { duration: 5 } },
      { contentId: 'immich:clip', format: 'video', mediaType: 'video', slideshow: { duration: 5 } },
      { contentId: 'immich:photo-2', format: 'image', mediaType: 'image', slideshow: { duration: 5 } },
    ]} />);
    await waitFor(() => expect(latest()?.contentId).toBe('immich:photo'));

    act(() => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    await waitFor(() => expect(latest()?.contentId).toBe('immich:clip'));

    // A single arrow press on video remains available to the renderer for seek.
    act(() => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    expect(latest()?.contentId).toBe('immich:clip');

    // A second press advances the slideshow item.
    act(() => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    await waitFor(() => expect(latest()?.contentId).toBe('immich:photo-2'));

    act(() => { fireEvent.keyDown(window, { key: 'ArrowLeft' }); });
    await waitFor(() => expect(latest()?.contentId).toBe('immich:clip'));

    // Long-press repeat advances from a video without requiring a second tap.
    act(() => { fireEvent.keyDown(window, { key: 'ArrowLeft', repeat: true }); });
    await waitFor(() => expect(latest()?.contentId).toBe('immich:photo'));
  });

  it('supports explicit up/down navigation for an auxiliary music queue', async () => {
    render(<Player
      auxiliary
      ignoreKeys
      queueNavigationKeys={{ previous: 'ArrowUp', next: 'ArrowDown' }}
      play={[
        { contentId: 'plex:track-1', format: 'audio', mediaType: 'audio' },
        { contentId: 'plex:track-2', format: 'audio', mediaType: 'audio' },
      ]}
    />);
    await waitFor(() => expect(latest()?.contentId).toBe('plex:track-1'));

    act(() => { fireEvent.keyDown(window, { key: 'ArrowDown' }); });
    await waitFor(() => expect(latest()?.contentId).toBe('plex:track-2'));

    act(() => { fireEvent.keyDown(window, { key: 'ArrowUp' }); });
    await waitFor(() => expect(latest()?.contentId).toBe('plex:track-1'));
  });
});
