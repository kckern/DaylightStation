import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react';

let currentTrack = null;
vi.mock('../../../__app_modules/media/art/browser/music/useBackgroundMusic.js', () => ({
  useBackgroundMusic: () => ({ track: currentTrack, next() {}, prev() {}, toggle() {}, seek() {} }),
}));
vi.mock('../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn(), DaylightMediaPath: (p) => p }));
vi.mock('../../../frontend/src/lib/logging/singleton.js', () => ({ getChildLogger: () => ({ info() {}, warn() {}, debug() {}, error() {} }) }));
vi.mock('../../../frontend/src/hooks/useWebSocket.js', () => ({ useWebSocketSubscription() {} }));
import { DaylightAPI } from '../../../frontend/src/lib/api.mjs';
import ArtMode from '../../../frontend/src/composition/screens/widgets/ArtMode.jsx';

const music = { queue: 'fixture', eligibilityProfile: 'quiet' };
const matching = { profile: 'quiet' };
const measure = () => 50;
const scene = () => <ArtMode music={music} matching={matching} advance="timer" intervalSec={0.02} placard={false}
  curtainCloseMs={0} curtainMinMs={0} curtainMaxMs={50} measureText={measure} />;
const artwork = (id) => ({ mode: 'single', panels: [{ image: `${id}.jpg`, meta: { title: `Picture ${id}`, width: 600, height: 900 } }], match: { artId: id, kind: 'matched' } });
const track = (id, occurrence = 1) => ({ id, occurrence, title: 'Same hymn', artist: 'Same artist' });
const shown = (title) => waitFor(() => expect(screen.getByAltText(title)).toBeInTheDocument(), { timeout: 800 });

describe('matched ArtMode', () => {
  beforeEach(() => { currentTrack = null; DaylightAPI.mockReset(); DaylightAPI.mockImplementation(async (_url, data) => artwork(data.trackId)); });
  afterEach(cleanup);

  it('waits for the actual first recording instead of loading random art', async () => {
    const view = render(scene());
    expect(DaylightAPI).not.toHaveBeenCalled();
    currentTrack = track('plex:101'); view.rerender(scene());
    await shown('Picture plex:101');
    expect(screen.getAllByTestId('artmode-image')).toHaveLength(1);
  });

  it('matches distinct recordings even when titles and artists are identical', async () => {
    currentTrack = track('plex:101'); const view = render(scene()); await shown('Picture plex:101');
    currentTrack = track('plex:102', 2); view.rerender(scene()); await shown('Picture plex:102');
    expect(screen.queryByAltText('Picture plex:101')).not.toBeInTheDocument();
  });

  it('rejects late responses from a skipped recording', async () => {
    let resolveOld;
    DaylightAPI.mockImplementation((_url, data) => data.trackId === 'plex:101'
      ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve(artwork('plex:102')));
    currentTrack = track('plex:101'); const view = render(scene());
    currentTrack = track('plex:102', 2); view.rerender(scene()); await shown('Picture plex:102');
    await act(async () => { resolveOld(artwork('plex:101')); await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(screen.getByAltText('Picture plex:102')).toBeInTheDocument();
    expect(screen.queryByAltText('Picture plex:101')).not.toBeInTheDocument();
  });

  it('clears the old image when the new track has only neutral output', async () => {
    currentTrack = track('plex:101'); const view = render(scene()); await shown('Picture plex:101');
    DaylightAPI.mockResolvedValue({ mode: 'neutral', panels: [], match: { kind: 'neutral' } });
    currentTrack = track('plex:102', 2); view.rerender(scene());
    await waitFor(() => expect(screen.queryByTestId('artmode-image')).not.toBeInTheDocument(), { timeout: 800 });
  });

  it('holds the selected piece through time and brightness changes', async () => {
    let count = 0; DaylightAPI.mockImplementation(async () => artwork(`selection-${++count}`));
    currentTrack = track('plex:101'); render(scene()); await shown('Picture selection-1');
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 90)); });
    expect(screen.getByAltText('Picture selection-1')).toBeInTheDocument();
    expect(count).toBe(1);
  });

  it('returns to neutral if the current matched image fails in the browser', async () => {
    currentTrack = track('plex:101'); render(scene()); await shown('Picture plex:101');
    fireEvent.error(screen.getByAltText('Picture plex:101'));
    await waitFor(() => expect(screen.queryByTestId('artmode-image')).not.toBeInTheDocument());
    expect(DaylightAPI).toHaveBeenCalledTimes(1);
  });
});
