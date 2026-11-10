// The reading stage mounts its Player directly (not through ScreenPlayer), so it
// must register that Player with the screen's playback registry itself — or the
// living-room TV reads idle in /media fleet for the whole story.
import { describe, it, expect, vi } from 'vitest';
import { forwardRef, useImperativeHandle } from 'react';
import { render } from '@testing-library/react';

const handle = { getMediaElement: () => null, getNowPlaying: () => ({ title: 'A Story' }) };
vi.mock("../../../../../__capabilities/playback/browser/player/Player.jsx", () => ({
  default: forwardRef(function FakePlayer(_props, ref) {
    useImperativeHandle(ref, () => handle);
    return null;
  }),
}));
vi.mock("../../../../../__capabilities/playback/browser/surround-frame.mjs", () => ({
  default: ({ children }) => children,
}));

const bindings = [];
vi.mock("../../../../../__capabilities/playback/browser/sessions.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  usePlayerSessionBinding: (getHandle) => { bindings.push(getHandle); },
}));
vi.mock("../../../../../frontend/src/lib/logging/Logger.js", () => ({
  default: () => ({ child: () => ({ debug() {}, info() {}, warn() {}, error() {} }) }),
}));

import { ReadingStage } from './ReadingSessionScreen.jsx';

describe('ReadingStage fleet visibility', () => {
  it('binds its Player to the playback registry with the live imperative handle', () => {
    const snapshot = { contentId: 'plex:1' };
    const store = { get: () => snapshot, subscribe: () => () => {} };
    render(
      <ReadingStage
        store={store}
        play={{ contentId: 'plex:1' }}
        getMediaEl={() => null}
        onMediaRef={() => {}}
        onPlaybackCompleted={() => {}}
        clear={() => {}}
      />,
    );
    expect(bindings.length).toBeGreaterThan(0);
    expect(bindings.at(-1)()).toBe(handle);
  });
});
