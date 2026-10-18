import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';

const controls = {};
vi.mock('../../../__capabilities/screen-host/browser/input.mjs', () => ({
  useScreenAction: (name, callback) => { controls[name] = callback; },
}));
vi.mock('../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn(), DaylightMediaPath: (value) => value }));
vi.mock('../../../frontend/src/lib/logging/singleton.js', () => ({ getChildLogger: () => ({ info() {}, warn() {}, debug() {}, error() {} }) }));
vi.mock('../../../frontend/src/hooks/useWebSocket.js', () => ({ useWebSocketSubscription() {} }));
import { DaylightAPI } from '../../../frontend/src/lib/api.mjs';
import ArtMode from '../../../frontend/src/composition/screens/widgets/ArtMode.jsx';

const approved = (id) => ({ contentId: id, title: 'Same hymn', artist: 'Same artist', mediaUrl: `${id}.wav` });
const scene = () => <ArtMode matching={{ profile: 'quiet' }} music={{ queue: 'fixture-queue', shuffle: false }}
  placard={false} advance="timer" intervalSec={0.01} curtainCloseMs={0} curtainMinMs={0} curtainMaxMs={50} measureText={() => 50} />;
const matchCalls = () => DaylightAPI.mock.calls.filter(([url]) => url.endsWith('/match'));
const shown = (title) => waitFor(() => expect(screen.getByAltText(title)).toBeInTheDocument());

describe('ArtMode with the real background-music hook', () => {
  beforeEach(() => {
    DaylightAPI.mockReset();
    const paused = new WeakMap();
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function () { return paused.get(this) ?? true; });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () { paused.set(this, false); return Promise.resolve(); });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function () { paused.set(this, true); });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  function respond(items) {
    let selection = 0;
    DaylightAPI.mockImplementation(async (url, data) => {
      if (url.includes('/queue/')) return { items };
      if (url.endsWith('/tracks')) return { trackIds: ['plex:101', 'plex:102'] };
      if (url.endsWith('/match')) return { mode: 'single', panels: [{ image: `${data.trackId}-${++selection}.jpg`, meta: {
        title: `Picture ${data.trackId} take ${selection}`, width: 600, height: 900,
      } }], match: { kind: 'matched', artId: `art:${selection}` } };
      throw new Error(`Unexpected API ${url}`);
    });
  }

  it('matches the first approved recording, holds through pause/seek, and changes once on a same-label next recording', async () => {
    respond([approved('plex:999'), approved('plex:101'), approved('plex:102')]);
    render(scene());
    await shown('Picture plex:101 take 1');
    const audio = screen.getByTestId('artmode-music');
    expect(audio.getAttribute('src')).toBe('plex:101.wav');
    expect(screen.getAllByTestId('artmode-image')).toHaveLength(1);
    act(() => controls['media:playback']({ command: 'pause' }));
    expect(audio.paused).toBe(true);
    act(() => controls['media:playback']({ command: 'fwd' }));
    expect(audio.currentTime).toBeGreaterThan(0);
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 65)); });
    expect(matchCalls()).toHaveLength(1);
    act(() => controls['media:playback']({ command: 'play' }));
    expect(audio.paused).toBe(false);
    fireEvent.ended(audio);
    await shown('Picture plex:102 take 2');
    expect(screen.getAllByTestId('artmode-image')).toHaveLength(1);
    expect(matchCalls().map(([, data]) => data.trackId)).toEqual(['plex:101', 'plex:102']);
  });

  it('makes a new selection on a repeat occurrence of the same recording', async () => {
    respond([approved('plex:101')]);
    render(scene());
    await shown('Picture plex:101 take 1');
    fireEvent.ended(screen.getByTestId('artmode-music'));
    await shown('Picture plex:101 take 2');
    expect(matchCalls().map(([, data]) => data.trackId)).toEqual(['plex:101', 'plex:101']);
    expect(screen.getAllByTestId('artmode-image')).toHaveLength(1);
  });
});
