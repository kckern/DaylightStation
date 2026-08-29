// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  api: vi.fn(), start: vi.fn(), resume: vi.fn(), end: vi.fn(), dispatch: vi.fn(), retryMedia: vi.fn(),
  state: { value: 'idle', media: { audio: false, video: false }, controlConnected: true },
  media: { status: 'ready', stream: null, errors: {}, retry: vi.fn() },
}));
vi.mock('../lib/api.mjs', () => ({ DaylightAPI: mocks.api }));
vi.mock('../hooks/useDocumentTitle.js', () => ({ default: vi.fn() }));
vi.mock('../lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }) }));
vi.mock('../modules/Input/hooks/useIndependentMedia.js', () => ({ useIndependentMedia: () => mocks.media }));
vi.mock('../modules/Input/hooks/useWebRTCPeer.js', () => ({ useWebRTCPeer: () => ({ remoteStream: null }) }));
vi.mock('./call/useCallController.js', () => ({ useCallController: () => ({
  state: mocks.state, start: mocks.start, resume: mocks.resume, end: mocks.end,
  dispatch: mocks.dispatch, retryMedia: mocks.retryMedia, sendMuteState: vi.fn(),
}) }));

import CallApp from './CallApp.jsx';

describe('CallApp presentation', () => {
  beforeEach(() => {
    mocks.api.mockReset(); mocks.start.mockReset(); mocks.end.mockReset(); mocks.dispatch.mockReset(); mocks.retryMedia.mockReset();
    mocks.state = { value: 'idle', media: { audio: false, video: false }, controlConnected: true };
    mocks.media = { status: 'ready', stream: null, errors: {}, retry: vi.fn() };
    sessionStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('shows one explicit Call action and never auto-starts it', async () => {
    mocks.api.mockResolvedValue({ devices: [{ id: 'tv', name: 'Living Room', capabilities: { contentControl: true } }] });
    render(<CallApp />);
    const button = await screen.findByRole('button', { name: 'Call Living Room' });
    expect(mocks.start).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ id: 'tv' }));
  });

  it('distinguishes device fetch failure and provides a retry', async () => {
    mocks.api.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ devices: [] });
    render(<CallApp />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load TVs.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('No video call TVs are configured.')).toBeTruthy());
    expect(mocks.api).toHaveBeenCalledTimes(2);
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
