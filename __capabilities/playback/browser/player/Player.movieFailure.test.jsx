import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ args: null, frame: null, overlay: {} }));
vi.mock('./components/SinglePlayer.jsx', () => ({ SinglePlayer: props => { state.frame = props; return <div />; } }));
vi.mock('./hooks/useMediaResilience.js', async original => ({ ...(await original()), useMediaResilience: args => {
  state.args = args;
  return { overlayProps: state.overlay, cancelDeadline: () => {}, requestRecovery: () => {} };
} }));
vi.mock('../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockRejectedValue(new Error('offline')) }));
import Player from './Player.jsx';
import { PlaybackSurfaceProvider } from './PlaybackSurfaceContext.js';

const movie = { contentId: 'plex:1', format: 'video', mediaType: 'video', duration: 600, title: 'Movie' };
const queue = [movie, { ...movie, contentId: 'plex:2' }, { ...movie, contentId: 'plex:3' }];
beforeEach(() => { state.args = null; state.frame = null; state.overlay = {}; });
afterEach(cleanup);
const exhausted = reason => act(() => state.args.onExhausted({ reason, attempts: 3 }));

describe('finite movie terminal failure', () => {
  // Removing the finite-video hold branch would advance this owner's queue.
  it('holdsExhaustedFiniteVideo with the same owner visit and queue', async () => {
    const ref = React.createRef(); const clear = vi.fn(); const events = vi.fn();
    render(<Player ref={ref} play={queue} clear={clear} onResilienceEvent={events} />);
    await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
    const target = ref.current.getRecoveryTarget();
    exhausted('stall-jolt-exhausted');
    expect(state.frame.contentId).toBe('plex:1');
    expect(ref.current.getRecoveryTarget()).toEqual(target);
    expect(ref.current.getQueueSnapshot().items).toHaveLength(3);
    expect(clear).not.toHaveBeenCalled();
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ kind: 'resilience-held', reason: 'stall-jolt-exhausted', attempts: 3, target, retryAfterMs: 0 }));
  });
  it('holds a final refused movie instead of clearing it', async () => {
    const clear = vi.fn();
    render(<Player play={movie} clear={clear} />);
    await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
    exhausted('source-unavailable-gave-up');
    expect(clear).not.toHaveBeenCalled();
    expect(state.frame.contentId).toBe('plex:1');
  });
  it.each([{ ...movie, format: 'audio', mediaType: 'audio' }, { ...movie, continuous: true }, { ...movie, isLive: true }])('retains excluded terminal behavior for %j', async item => {
    const clear = vi.fn();
    render(<Player play={item} clear={clear} />);
    await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
    exhausted('stall-jolt-exhausted');
    expect(clear).toHaveBeenCalledTimes(1);
  });
  it('explicitSkipAdvancesOnce via its focusable control', async () => {
    state.overlay = { isExhausted: true, shouldRender: true, isVisible: true };
    const view = render(<Player play={queue} clear={() => {}} />);
    await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
    exhausted('stall-jolt-exhausted');
    const skip = view.getByRole('button', { name: /Skip/ });
    expect(skip.tabIndex).toBe(0);
    fireEvent.click(skip);
    expect(state.frame.contentId).toBe('plex:2');
  });
  it('focused Retry owns Enter instead of the page Skip listener', async () => {
    const retry = vi.fn();
    state.overlay = { isExhausted: true, shouldRender: true, isVisible: true, onRetryFromExhausted: retry };
    const view = render(<Player holdOnRefusal play={queue} clear={() => {}} />);
    await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
    exhausted('source-unavailable-gave-up');
    const button = view.getByRole('button', { name: /^Try again/ });
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(state.frame.contentId).toBe('plex:1');
  });
  it('shows held recovery controls through a deliberate pause overlay', async () => {
    state.overlay = { isExhausted: true, shouldRender: true, isVisible: true, pauseOverlayActive: true };
    const view = render(<Player play={queue} clear={() => {}} />);
    await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
    exhausted('stall-jolt-exhausted');
    expect(view.getByRole('button', { name: /^Try again/ })).toBeVisible();
  });
});

// A playing picture of `height` lines, registered the way the renderer does.
const withVideo = (height, { currentTime = 0 } = {}) => {
  const node = document.createElement('video');
  Object.defineProperty(node, 'currentTime', { configurable: true, value: currentTime });
  Object.defineProperty(node, 'videoHeight', { configurable: true, value: height });
  act(() => state.frame.onMediaRef(node, { contentId: 'plex:1', rendererToken: Object.freeze({ tokenId: 'v', node, resolvedContentId: 'plex:1' }) }));
  return node;
};
const on = (input, el) => <PlaybackSurfaceProvider input={input}>{el}</PlaybackSurfaceProvider>;

it('held Lower quality applies through guarded owner adoption at the paused position', async () => {
  const ref = React.createRef();
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true };
  const view = render(<Player ref={ref} play={queue} clear={() => {}} />);
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  withVideo(1080);
  act(() => state.frame.onPlaybackMetrics({ seconds: 321, isPaused: true, pauseIntent: 'user' }));
  exhausted('stall-jolt-exhausted');
  const target = ref.current.getRecoveryTarget();
  fireEvent.click(view.getByRole('button', { name: 'Lower quality (720p)' }));
  await waitFor(() => expect(state.frame.maxResolution).toBe('720'));
  expect(ref.current.getRecoveryTarget().visitId).toBe(target.visitId);
  expect(ref.current.getQueueSnapshot().items).toHaveLength(3);
  expect(state.frame.initialRendererOperation?.autoplay ?? state.frame.remountDiagnostics?.rendererOperation?.autoplay).toBe(false);
});

it('shows the rolling-cap retry delay, and no spinner pretends it is loading', async () => {
  const retry = vi.fn();
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true, retryAfterMs: 12000, onRetryFromExhausted: retry };
  const view = render(<Player play={queue} />);
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  exhausted('stall-jolt-exhausted');
  expect(view.getByRole('button', { name: 'Try again in 12s' })).toBeDisabled();
  expect(view.container.querySelector('.loading-spinner')).toBeNull();
  expect(view.getByText('The video stopped loading')).toBeVisible();
});

it('keeps the held card after a deliberate owner pause changes intent', async () => {
  const ref = React.createRef();
  state.overlay = { isExhausted: false, shouldRender: false, isVisible: false };
  const view = render(<Player ref={ref} play={queue} />);
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  exhausted('stall-jolt-exhausted');
  act(() => ref.current.pause());
  expect(view.getByRole('button', { name: /^Try again/ })).toBeVisible();
  expect(view.getByRole('button', { name: 'Skip to Movie' })).toBeVisible();
});

it('D-pad moves between held actions and Enter never reaches broad playback keys', async () => {
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true };
  const view = render(on('remote', <Player holdOnRefusal play={queue} />));
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  exhausted('stall-jolt-exhausted');
  expect(view.getByRole('button', { name: /^Try again/ })).toHaveFocus();
  fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' });
  expect(view.getByRole('button', { name: 'Skip to Movie' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' });
  const broadKey = vi.fn(); window.addEventListener('keydown', broadKey);
  fireEvent.keyDown(document.activeElement, { key: 'Enter' });
  window.removeEventListener('keydown', broadKey);
  expect(broadKey).not.toHaveBeenCalled();
  expect(state.frame.contentId).toBe('plex:1');
  expect(view.getByTestId('player-held-keys')).toHaveTextContent('Choose');
});

it('a single item offers no Skip — even with a host skip handler — and never a Close', async () => {
  const skip = vi.fn();
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true };
  const view = render(<Player play={movie} clear={() => {}} onSkipHeldPlayback={skip} />);
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  exhausted('stall-jolt-exhausted');
  expect(view.queryByRole('button', { name: /Skip/ })).toBeNull();
  expect(view.queryByRole('button', { name: /Close/ })).toBeNull();
  expect(view.queryByRole('dialog')).toBeNull();
});

it('a held movie gives the remote an initial focus on the first enabled action', async () => {
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true, retryAfterMs: 12000 };
  const view = render(on('remote', <Player play={queue} />));
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  exhausted('stall-jolt-exhausted');
  expect(view.getByRole('button', { name: 'Skip to Movie' })).toHaveFocus();
});

it('D-pad alone reaches Lower quality and applies it without moving the movie visit', async () => {
  const ref = React.createRef();
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true };
  const view = render(on('remote', <Player ref={ref} play={queue} />));
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  withVideo(1080);
  const target = ref.current.getRecoveryTarget();
  exhausted('stall-jolt-exhausted');
  fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' });
  fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' });
  expect(view.getByRole('button', { name: 'Lower quality (720p)' })).toHaveFocus();
  fireEvent.keyDown(document.activeElement, { key: 'Enter' });
  await waitFor(() => expect(state.frame.maxResolution).toBe('720'));
  expect(ref.current.getRecoveryTarget().visitId).toBe(target.visitId);
  expect(ref.current.getQueueSnapshot().items).toHaveLength(3);
});

it('numpad: no buttons it could never reach; names its keys, and Play/Pause tries again', async () => {
  const ref = React.createRef();
  const retry = vi.fn(() => ({ ok: true }));
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true, onRetryFromExhausted: retry };
  const view = render(on('numpad', <Player ref={ref} play={queue} />));
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  exhausted('stall-jolt-exhausted');
  expect(view.queryAllByRole('button')).toHaveLength(0);
  expect(view.getByTestId('player-held-keys')).toHaveTextContent('Play/Pause');
  expect(view.getByTestId('player-held-keys')).toHaveTextContent('Skip to Movie');
  act(() => { ref.current.toggle(); });
  expect(retry).toHaveBeenCalledTimes(1);
});

it('numpad: during the retry cooldown Play/Pause does nothing (no refused retry, no play on a dead element)', async () => {
  const ref = React.createRef();
  const retry = vi.fn(() => ({ ok: false, code: 'rolling-cap' }));
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true, retryAfterMs: 9000, onRetryFromExhausted: retry };
  const view = render(on('numpad', <Player ref={ref} play={queue} />));
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  exhausted('stall-jolt-exhausted');
  act(() => { ref.current.toggle(); });
  expect(retry).not.toHaveBeenCalled();
  expect(view.getByTestId('player-held-keys')).toHaveTextContent('Try again in 9s');
});

it('Lower quality survives a remount that leaves the element without a picture height', async () => {
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true };
  const view = render(<Player play={queue} />);
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  withVideo(1080);
  withVideo(0); // the ladder's last remount: a fresh element with no frame yet
  exhausted('stall-jolt-exhausted');
  expect(view.getByRole('button', { name: 'Lower quality (720p)' })).toBeVisible();
});

it('Lower quality keeps the other quality limits already in force', async () => {
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true };
  const items = [{ ...movie, maxVideoBitrate: 3000 }, queue[1]];
  const view = render(<Player play={items} />);
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  act(() => { state.frame.onResolvedMeta(items[0]); });
  withVideo(1080);
  exhausted('stall-jolt-exhausted');
  fireEvent.click(view.getByRole('button', { name: 'Lower quality (720p)' }));
  await waitFor(() => expect(state.frame.maxResolution).toBe('720'));
  expect(state.frame.maxVideoBitrate).toBe(3000);
});

it('no input: no buttons; the card states the automatic plan', async () => {
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true };
  const view = render(on('none', <Player play={queue} />));
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  exhausted('stall-jolt-exhausted');
  expect(view.queryAllByRole('button')).toHaveLength(0);
  expect(view.getByTestId('player-held-plan')).toHaveTextContent('Trying again in 20s (attempt 1 of 3)');
});

it.each([
  [{ expectedEndSeconds: 5895, provenance: 'catalog', rendererStartSeconds: 0, contentStartSeconds: 4320 }, 4370],
  [{ expectedEndSeconds: 5895, provenance: 'catalog' }, 4320],
])('held Lower quality adopts confirmed content position with timeline %j', async (contentTimeline, expected) => {
  const ref = React.createRef();
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true };
  const items = [{ ...movie, duration: 5895, contentTimeline }, queue[1]];
  const view = render(<Player ref={ref} play={items} />);
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  act(() => { state.frame.onResolvedMeta(items[0]); });
  withVideo(1080, { currentTime: 50 });
  act(() => { state.frame.onPlaybackMetrics({ seconds: 4320, isPaused: true, pauseIntent: 'user' }); });
  exhausted('early-eof');
  fireEvent.click(view.getByRole('button', { name: 'Lower quality (720p)' }));
  await waitFor(() => expect(state.frame.maxResolution).toBe('720'));
  expect(state.frame.remountDiagnostics.rendererOperation.targetSeconds).toBe(expected);
  expect(state.frame.remountDiagnostics.rendererOperation.autoplay).toBe(false);
});
