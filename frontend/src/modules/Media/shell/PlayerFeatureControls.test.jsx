import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// Player features in the one set of controls: subtitles/audio (STEER.12a),
// music behind a slideshow (PLAY.9a), Shown briefly (PLAY.8a).
const session = { snapshot: null, controller: null };
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({ snapshot: session.snapshot, controller: session.controller }),
}));
vi.mock('../../Content/combobox/ContentCombobox.jsx', () => ({
  ContentCombobox: ({ onChange, searchParams }) => (
    <button type="button" data-testid="fake-combobox" data-scope={searchParams}
      onClick={() => onChange('plex:584614', { title: 'Faith' })}>pick</button>
  ),
}));

import { PlayerFeatureControls, useSlideshowStopGuard } from './PlayerFeatureControls.jsx';
import { getLocalPlayerFeatures, __resetLocalPlayerFeatures } from '../session/localPlayerFeatures.js';

const REMOTE = { deviceId: 'livingroom-tv' };
const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);
const tracks = {
  contentId: 'plex:665638', source: 'plex',
  audio: [{ id: '1278356', language: 'eng', label: 'English (EAC3 5.1)' }],
  subtitles: [{ id: '1278358', language: 'eng', label: 'English' }, { id: '1278377', language: 'ell', label: 'Ελληνικά' }],
  selected: { audio: '1278356', subtitle: null },
};
const remoteControls = () => ({
  setTracks: vi.fn(async () => ({ ok: true })),
  musicBehind: vi.fn(async () => ({ ok: true })),
  closeBrief: vi.fn(async () => ({ ok: true })),
});

beforeEach(() => {
  __resetLocalPlayerFeatures();
  session.snapshot = null;
  session.controller = { sessionControls: remoteControls() };
});

describe('subtitles and audio language (STEER.12a)', () => {
  it('offers only the item\'s subtitles, and a screen\'s choice goes through its Remote (AC1, AC2)', async () => {
    session.snapshot = { state: 'playing', currentItem: { contentId: 'plex:665638', format: 'dash_video' }, controls: { tracks } };
    wrap(<PlayerFeatureControls target={REMOTE} />);
    expect(screen.getByTestId('pf-subtitles')).toHaveTextContent('Subtitles: Off');
    // One audio track: nothing to choose, so no audio control.
    expect(screen.queryByTestId('pf-audio')).toBeNull();
    fireEvent.click(screen.getByTestId('pf-subtitles'));
    const menu = await screen.findByTestId('pf-subtitles-menu');
    expect(menu).toHaveTextContent('English');
    expect(menu).toHaveTextContent('Ελληνικά');
    expect(menu.querySelectorAll('[data-testid^="pf-subtitle-"]')).toHaveLength(3); // Off + the two the item has
    expect(screen.getByTestId('pf-subtitle-off')).toHaveAttribute('data-selected', 'true');
    fireEvent.click(screen.getByTestId('pf-subtitle-1278358'));
    await waitFor(() => expect(session.controller.sessionControls.setTracks).toHaveBeenCalledWith({ subtitle: '1278358' }));
  });

  it('shows audio choices when the item has more than one, and works for this device', async () => {
    const local = getLocalPlayerFeatures();
    const setTracks = vi.fn(() => ({ ok: true }));
    local.bindPlayer({ setTracks });
    session.snapshot = { state: 'playing', currentItem: { contentId: 'plex:1', format: 'dash_video' } };
    wrap(<PlayerFeatureControls target="local" />);
    act(() => local.setTrackState({ ...tracks, contentId: 'plex:1',
      audio: [...tracks.audio, { id: '9', language: 'fra', label: 'Français' }], selected: { audio: '1278356', subtitle: '1278358' } }));
    expect(screen.getByTestId('pf-subtitles')).toHaveTextContent('Subtitles: English');
    fireEvent.click(screen.getByTestId('pf-audio'));
    fireEvent.click(await screen.findByTestId('pf-audio-9'));
    await waitFor(() => expect(setTracks).toHaveBeenCalledWith({ audio: '9' }));
  });

  it('ignores track state that belongs to a previous item', () => {
    session.snapshot = { state: 'playing', currentItem: { contentId: 'plex:2', format: 'dash_video' }, controls: { tracks } };
    wrap(<PlayerFeatureControls target={REMOTE} />);
    expect(screen.queryByTestId('pf-subtitles')).toBeNull();
  });

  it('says so when the screen refuses', async () => {
    session.controller.sessionControls.setTracks.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'UNKNOWN_TRACK' }));
    session.snapshot = { state: 'playing', currentItem: { contentId: 'plex:665638', format: 'dash_video' }, controls: { tracks } };
    wrap(<PlayerFeatureControls target={REMOTE} />);
    fireEvent.click(screen.getByTestId('pf-subtitles'));
    fireEvent.click(await screen.findByTestId('pf-subtitle-1278377'));
    expect(await screen.findByTestId('pf-feedback')).toHaveTextContent('That track is not available');
  });
});

describe('music behind a slideshow (PLAY.9a)', () => {
  const slideshow = (controls = {}) => ({ state: 'playing', currentItem: { contentId: 'immich:a1', format: 'image' }, controls });

  it('is offered only while a slideshow plays, and lets me choose music (AC1)', async () => {
    session.snapshot = { state: 'playing', currentItem: { contentId: 'plex:1', format: 'video' }, controls: {} };
    const { unmount } = wrap(<PlayerFeatureControls target={REMOTE} />);
    expect(screen.queryByTestId('pf-music-add')).toBeNull();
    unmount();
    session.snapshot = slideshow();
    wrap(<PlayerFeatureControls target={REMOTE} />);
    fireEvent.click(screen.getByTestId('pf-music-add'));
    expect(await screen.findByTestId('fake-combobox')).toHaveAttribute('data-scope', 'mediaType=audio');
    fireEvent.click(screen.getByTestId('fake-combobox'));
    await waitFor(() => expect(session.controller.sessionControls.musicBehind)
      .toHaveBeenCalledWith('start', { contentId: 'plex:584614', title: 'Faith' }));
  });

  it('steers the music separately from the photos (AC2)', async () => {
    session.snapshot = slideshow({ musicBehind: { contentId: 'plex:584614', title: 'Faith', state: 'playing', trackTitle: 'Faith' } });
    wrap(<PlayerFeatureControls target={REMOTE} />);
    expect(screen.getByTestId('pf-music-title')).toHaveTextContent('Faith');
    fireEvent.click(screen.getByTestId('pf-music-next'));
    fireEvent.click(screen.getByTestId('pf-music-toggle'));
    await waitFor(() => expect(session.controller.sessionControls.musicBehind.mock.calls.map((c) => c[0])).toEqual(['next', 'pause']));
  });
});

function StopHarness({ target, onStop }) {
  const [guardStop, dialog] = useSlideshowStopGuard(target);
  return <><button type="button" data-testid="stop" onClick={() => guardStop(onStop)}>stop</button>{dialog}</>;
}

describe('stopping the slideshow asks whether to keep the music (PLAY.9a/AC3)', () => {
  const withMusic = { state: 'playing', currentItem: { contentId: 'immich:a1', format: 'image' },
    controls: { musicBehind: { contentId: 'plex:584614', title: 'Faith', state: 'playing' } } };

  it('Keep music stops only the photos', async () => {
    session.snapshot = withMusic;
    const onStop = vi.fn();
    wrap(<StopHarness target={REMOTE} onStop={onStop} />);
    fireEvent.click(screen.getByTestId('stop'));
    expect(onStop).not.toHaveBeenCalled();
    expect(await screen.findByTestId('pf-stop-guard')).toHaveTextContent('Keep the music playing?');
    fireEvent.click(screen.getByTestId('pf-stop-keep-music'));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(session.controller.sessionControls.musicBehind).not.toHaveBeenCalled();
  });

  it('Stop music too stops both', async () => {
    session.snapshot = withMusic;
    const onStop = vi.fn();
    wrap(<StopHarness target={REMOTE} onStop={onStop} />);
    fireEvent.click(screen.getByTestId('stop'));
    fireEvent.click(await screen.findByTestId('pf-stop-both'));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(session.controller.sessionControls.musicBehind).toHaveBeenCalledWith('stop');
  });

  it('no music: Stop just stops', () => {
    session.snapshot = { ...withMusic, controls: {} };
    const onStop = vi.fn();
    wrap(<StopHarness target={REMOTE} onStop={onStop} />);
    fireEvent.click(screen.getByTestId('stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('pf-stop-guard')).toBeNull();
  });
});

describe('Shown briefly on a screen (PLAY.8a)', () => {
  it('says what is shown and closes it remotely', async () => {
    session.snapshot = { state: 'paused', currentItem: { contentId: 'plex:1', format: 'video' },
      controls: { brief: { kind: 'camera', label: 'Doorbell · from Doorbell', remainingSeconds: 25 } } };
    wrap(<PlayerFeatureControls target={REMOTE} />);
    expect(screen.getByTestId('pf-brief')).toHaveTextContent('Showing Doorbell · from Doorbell · 25s');
    fireEvent.click(screen.getByTestId('pf-brief-close'));
    await waitFor(() => expect(session.controller.sessionControls.closeBrief).toHaveBeenCalled());
  });
});
