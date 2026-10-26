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
import { MantineProvider } from '@mantine/core';

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
    const button = view.getByRole('button', { name: /^Retry/ });
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(state.frame.contentId).toBe('plex:1');
  });
  it('shows held recovery controls through a deliberate pause overlay', async () => {
    state.overlay = { isExhausted: true, shouldRender: true, isVisible: true, pauseOverlayActive: true };
    const view = render(<Player play={queue} clear={() => {}} />);
    await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
    exhausted('stall-jolt-exhausted');
    expect(view.getByRole('button', { name: /^Retry/ })).toBeVisible();
  });
});

it('held Quality is focusable and applies through guarded owner adoption at the paused position', async () => {
  const ref = React.createRef();
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true };
  const view = render(<MantineProvider><Player ref={ref} play={queue} clear={() => {}} /></MantineProvider>);
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  act(() => state.frame.onPlaybackMetrics({ seconds: 321, isPaused: true, pauseIntent: 'user' }));
  exhausted('stall-jolt-exhausted');
  const target = ref.current.getRecoveryTarget();
  const quality = view.getByRole('button', { name: /Quality/ });
  expect(quality.tabIndex).toBe(0);
  fireEvent.click(quality);
  expect(view.getByLabelText('Maximum resolution')).toHaveFocus();
  fireEvent.change(view.getByLabelText('Maximum resolution'), { target: { value: '480' } });
  fireEvent.click(view.getByRole('button', { name: 'Apply to current playback' }));
  await waitFor(() => expect(state.frame.maxResolution).toBe('480'));
  expect(ref.current.getRecoveryTarget().visitId).toBe(target.visitId);
  expect(ref.current.getQueueSnapshot().items).toHaveLength(3);
  expect(state.frame.initialRendererOperation?.autoplay ?? state.frame.remountDiagnostics?.rendererOperation?.autoplay).toBe(false);
});

it('shows the rolling-cap Retry delay and blocks spinner bypass', async () => {
  const retry = vi.fn();
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true, retryAfterMs: 12000, onRetryFromExhausted: retry };
  const view = render(<Player play={queue} />);
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  exhausted('stall-jolt-exhausted');
  expect(view.getByRole('button', { name: 'Retry in 12s' })).toBeDisabled();
  fireEvent.click(view.container.querySelector('.loading-spinner'));
  expect(retry).not.toHaveBeenCalled();
});

it('keeps all held controls after a deliberate owner pause changes intent', async () => {
  const ref = React.createRef();
  state.overlay = { isExhausted: false, shouldRender: false, isVisible: false };
  const view = render(<Player ref={ref} play={queue} />);
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  exhausted('stall-jolt-exhausted');
  act(() => ref.current.pause());
  expect(view.getByRole('button', { name: /^Retry/ })).toBeVisible();
  expect(view.getByRole('button', { name: /Quality/ })).toBeVisible();
  expect(view.getByRole('button', { name: /Skip/ })).toBeVisible();
});
it('D-pad focuses held controls and Enter never reaches broad playback keys', async () => {
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true };
  const view = render(<Player holdOnRefusal play={queue} />);
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  exhausted('stall-jolt-exhausted');
  const retry = view.getByRole('button', { name: /^Retry/ });
  retry.focus();
  fireEvent.keyDown(retry, { key: 'ArrowRight' });
  expect(view.getByRole('button', { name: /Quality/ })).toHaveFocus();
  const broadKey = vi.fn(); window.addEventListener('keydown', broadKey);
  fireEvent.keyDown(document.activeElement, { key: 'Enter' });
  window.removeEventListener('keydown', broadKey);
  expect(broadKey).not.toHaveBeenCalled();
  expect(state.frame.contentId).toBe('plex:1');
});

it('held Skip delegates to an external queue owner exactly once', async () => {
  const skip = vi.fn(); const clear = vi.fn();
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true };
  const view = render(<Player play={movie} clear={clear} onSkipHeldPlayback={skip} />);
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  exhausted('stall-jolt-exhausted');
  fireEvent.click(view.getByRole('button', { name: /Skip/ }));
  expect(skip).toHaveBeenCalledTimes(1);
  expect(clear).not.toHaveBeenCalled();
});

it('a held movie gives the remote an initial focus on the first available action', async () => {
  state.overlay = { isExhausted: true, shouldRender: true, isVisible: true, retryAfterMs: 12000 };
  const view = render(<Player play={queue} />);
  await waitFor(() => expect(state.frame?.contentId).toBe('plex:1'));
  exhausted('stall-jolt-exhausted');
  expect(view.getByRole('button', { name: /Quality/ })).toHaveFocus();
});
