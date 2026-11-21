import React, { useEffect } from 'react';
import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SinglePlayer } from './SinglePlayer.jsx';
import { fetchMediaInfo } from '../lib/api.js';
import { isIntroCovering, setIntroCovering } from '../../player-support/introCover.js';

/**
 * The intro starts from the play request: while SinglePlayer is still
 * fetching play info (before VideoPlayer exists), a title known to start from
 * the top already shows the scene instead of the spinner. The scene stays one
 * mounted element through the handoff to VideoPlayer's gate.
 */
vi.mock('../lib/api.js', () => ({ fetchMediaInfo: vi.fn() }));

const sceneMounts = { count: 0 };
function Scene({ stage }) {
  useEffect(() => { sceneMounts.count += 1; }, []);
  return <div data-testid="scene" data-stage={stage} />;
}
const introState = { status: 'ready', startSec: 0, calls: [] };
vi.mock('../../presentation.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  useVideoIntro: (args) => {
    introState.calls.push(args);
    if (!args?.media) return null;
    return { status: introState.status, minHoldMs: 6000, startSec: introState.startSec, render: (stage) => <Scene stage={stage} /> };
  },
}));

const video = { host: null };
vi.mock('../renderers/VideoPlayer.jsx', () => ({
  VideoPlayer: ({ introHost }) => { video.host = introHost; return <output data-testid="video" />; },
}));
vi.mock('../renderers/AudioPlayer.jsx', () => ({
  AudioPlayer: () => <output data-testid="audio" />,
}));

const PLAY_INFO = { id: 'plex:662169', assetId: 'plex:662169', mediaType: 'dash_video', format: 'dash_video', mediaUrl: '/api/v1/proxy/plex/stream/662169' };

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function play(props = {}) {
  return render(<SinglePlayer contentId="plex:662169" clear={vi.fn()} advance={vi.fn()} {...props} />);
}

describe('SinglePlayer intro from the play request', () => {
  let info;
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(introState, { status: 'ready', startSec: 0, calls: [] });
    sceneMounts.count = 0;
    video.host = null;
    info = deferred();
    fetchMediaInfo.mockReturnValue(info.promise);
  });
  afterEach(() => { setIntroCovering(false, 'gate'); setIntroCovering(false, 'host'); });

  it('shows the scene while play info is still loading, for a title that starts at the top', () => {
    play();
    expect(screen.getByTestId('scene')).toHaveAttribute('data-stage', 'covering');
    expect(isIntroCovering()).toBe(true);
    expect(screen.queryByTestId('video')).toBeNull();
  });

  it('never covers early over a resume or an unknown start', () => {
    introState.startSec = 1200;
    const a = play();
    expect(screen.queryByTestId('scene')).toBeNull();
    a.unmount();
    introState.startSec = null;
    play();
    expect(screen.queryByTestId('scene')).toBeNull();
  });

  it('takes an explicit start on the request over the intro read', () => {
    introState.startSec = null;
    const a = play({ seconds: 0 });
    expect(screen.getByTestId('scene')).toBeInTheDocument();
    a.unmount();
    introState.startSec = 0;
    play({ seconds: 3600 });
    expect(screen.queryByTestId('scene')).toBeNull();
  });

  it('does not cover early on a recovery remount', () => {
    play({ remountDiagnostics: { remountClass: 'recovery' } });
    expect(screen.queryByTestId('scene')).toBeNull();
  });

  it('hands the same scene to the gate: one mount from request to rolling', async () => {
    play();
    await act(async () => { info.resolve(PLAY_INFO); });
    expect(screen.getByTestId('video')).toBeInTheDocument();
    expect(video.host.intro.status).toBe('ready');
    expect(video.host.coverStartedAt).toEqual(expect.any(Number));
    act(() => video.host.onStage('waiting'));
    expect(screen.getByTestId('scene')).toHaveAttribute('data-stage', 'covering');
    act(() => video.host.onStage('covering'));
    act(() => video.host.onStage('holding'));
    expect(screen.getByTestId('scene')).toHaveAttribute('data-stage', 'holding');
    act(() => video.host.onStage('playing'));
    expect(screen.getByTestId('scene')).toHaveAttribute('data-stage', 'playing');
    expect(sceneMounts.count).toBe(1);
  });

  it('drops the scene when the gate says off, and a later remount cannot bring it back', async () => {
    play();
    await act(async () => { info.resolve(PLAY_INFO); });
    act(() => video.host.onStage('off'));
    expect(screen.queryByTestId('scene')).toBeNull();
    expect(isIntroCovering()).toBe(false);
    act(() => video.host.onStage('waiting'));
    expect(screen.queryByTestId('scene')).toBeNull();
  });

  it('asks for no intro once play info says the title is audio', async () => {
    play();
    await act(async () => { info.resolve({ ...PLAY_INFO, mediaType: 'audio', format: 'audio' }); });
    expect(screen.getByTestId('audio')).toBeInTheDocument();
    expect(screen.queryByTestId('scene')).toBeNull();
    expect(introState.calls.at(-1)).toEqual({ media: null, isPlex: false });
  });

  it('holds the spinner back while the intro is still deciding', () => {
    vi.useFakeTimers();
    try {
      introState.status = 'pending';
      play();
      expect(screen.queryByTestId('scene')).toBeNull();
      expect(isIntroCovering()).toBe(true);
      act(() => { vi.advanceTimersByTime(1500); });
      expect(isIntroCovering()).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
