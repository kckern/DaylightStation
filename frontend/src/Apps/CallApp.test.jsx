// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  api: vi.fn(), start: vi.fn(), resume: vi.fn(), end: vi.fn(), dispatch: vi.fn(), retryMedia: vi.fn(), loggerConfigure: vi.fn(),
  state: { value: 'idle', media: { audio: false, video: false }, controlConnected: true },
  media: { status: 'ready', stream: null, errors: {}, retry: vi.fn() },
}));
vi.mock('../lib/api.mjs', () => ({ DaylightAPI: mocks.api }));
vi.mock('../hooks/useDocumentTitle.js', () => ({ default: vi.fn() }));
vi.mock('../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
  configure: mocks.loggerConfigure,
}));
vi.mock('../modules/Input/hooks/useIndependentMedia.js', () => ({ useIndependentMedia: () => mocks.media }));
vi.mock('../modules/Input/hooks/useWebRTCPeer.js', () => ({ useWebRTCPeer: () => ({ remoteStream: null }) }));
vi.mock('./call/useCallController.js', () => ({ useCallController: () => ({
  state: mocks.state, start: mocks.start, resume: mocks.resume, end: mocks.end,
  dispatch: mocks.dispatch, retryMedia: mocks.retryMedia, sendMuteState: vi.fn(),
}) }));

import CallApp from './CallApp.jsx';

describe('CallApp presentation', () => {
  beforeEach(() => {
    mocks.api.mockReset(); mocks.start.mockReset(); mocks.end.mockReset(); mocks.dispatch.mockReset(); mocks.retryMedia.mockReset(); mocks.loggerConfigure.mockReset();
    mocks.state = { value: 'idle', media: { audio: false, video: false }, controlConnected: true };
    mocks.media = { status: 'ready', stream: null, errors: {}, retry: vi.fn() };
    sessionStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('names each callable screen by its room and never auto-starts a call', async () => {
    mocks.api.mockResolvedValue({ devices: [
      { id: 'livingroom-tv', name: 'Living Room TV', location: 'Living Room', icon: '\u{1F4FA}', capabilities: { contentControl: true, videoCall: true } },
    ] });
    render(<CallApp />);
    expect(mocks.loggerConfigure).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ app: 'homeline-phone', sessionLog: true }) }));
    const button = await screen.findByRole('button', { name: /Living Room TV/ });
    expect(button).toHaveTextContent('Living Room');
    expect(screen.getByRole('button', { name: 'Exit call screen' })).toBeTruthy();
    expect(mocks.start).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ id: 'livingroom-tv' }));
  });

  // A screen with content control but no camera cannot be the far end of a
  // call. Offering one is what put "office-tv" and "portal" in the lobby.
  it('offers only screens that can actually take a call', async () => {
    mocks.api.mockResolvedValue({ devices: [
      { id: 'livingroom-tv', name: 'Living Room TV', capabilities: { contentControl: true, videoCall: true } },
      { id: 'portal', name: 'Portal', capabilities: { contentControl: true, videoCall: false } },
      { id: 'office-tv', name: 'Office Screen', capabilities: { contentControl: true } },
    ] });
    render(<CallApp />);
    expect(await screen.findByRole('button', { name: /Living Room TV/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Portal/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Office Screen/ })).toBeNull();
  });

  it('falls back to the id only when no name is declared', async () => {
    mocks.api.mockResolvedValue({ devices: [{ id: 'livingroom-tv', capabilities: { videoCall: true } }] });
    render(<CallApp />);
    expect(await screen.findByRole('button', { name: 'livingroom-tv' })).toBeTruthy();
  });

  it('distinguishes device fetch failure and provides a retry', async () => {
    mocks.api.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ devices: [] });
    render(<CallApp />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load TVs.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('No screen in the house is set up to take a call.')).toBeTruthy());
    expect(mocks.api).toHaveBeenCalledTimes(2);
  });

  // The 401 that told a caller to sign in used to offer only "Back".
  it('offers a sign-in when the backend refuses the caller', async () => {
    mocks.state = { value: 'failed', reason: 'auth_required', error: 'Sign in to place a Home Line call.',
      media: { audio: false, video: false }, controlConnected: true };
    mocks.api.mockResolvedValue({ devices: [] });
    render(<CallApp />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in to place a Home Line call.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('presents Busy as an alert with a focused safe exit', async () => {
    mocks.state = { value: 'occupied', media: { audio: false, video: false }, controlConnected: true };
    mocks.api.mockResolvedValue({ devices: [] });
    render(<CallApp />);
    expect(screen.getByRole('alert')).toHaveTextContent('already in a call');
    const back = screen.getByRole('button', { name: 'Back' });
    expect(document.activeElement).toBe(back);
    fireEvent.click(back);
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'DISMISS' });
  });

  it('keeps degraded mode visible and exposes media retry', () => {
    mocks.state = { value: 'degraded', attemptId: 'a', media: { audio: true, video: false }, controlConnected: false };
    mocks.api.mockReturnValue(new Promise(() => {}));
    render(<CallApp />);
    expect(screen.getByText('Audio-only call')).toBeTruthy();
    expect(screen.getByText(/Controls reconnecting/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry media' }));
    expect(mocks.retryMedia).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['permission_denied', 'Microphone access was denied'],
    ['hardware_missing', 'No usable microphone was found'],
    ['device_busy', 'microphone is already in use'],
    ['constraints_failed', 'Microphone settings are not supported'],
  ])('shows distinct partial-media copy for %s', async (reason, copy) => {
    mocks.media = { status: 'ready', stream: null, errors: { audio: reason }, retry: vi.fn() };
    mocks.api.mockResolvedValue({ devices: [] });
    render(<CallApp />);
    expect(await screen.findByText(new RegExp(copy))).toBeTruthy();
    expect(screen.getByText(/continue with video only/)).toBeTruthy();
  });

  it('requires the visible countdown before dispatching hard recovery', async () => {
    vi.useFakeTimers();
    mocks.state = { value: 'recovery_prompt', attemptId: 'a', hardRecoveryUsed: false,
      media: { audio: false, video: false }, controlConnected: true };
    mocks.api.mockReturnValue(new Promise(() => {}));
    render(<CallApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Restart TV…' }));
    expect(screen.getByRole('button', { name: 'Confirm restart in 5' })).toBeDisabled();
    for (let second = 0; second < 5; second += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restart' }));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'HARD_RECOVERY', attemptId: 'a' });
  });
});
