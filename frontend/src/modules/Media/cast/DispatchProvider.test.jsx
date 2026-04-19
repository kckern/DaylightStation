import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

const subscribeFn = vi.fn();
vi.mock('../../../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn(), subscribe: (...a) => subscribeFn(...a), onStatusChange: vi.fn(() => () => {}) },
  default: { send: vi.fn(), subscribe: (...a) => subscribeFn(...a), onStatusChange: vi.fn(() => () => {}) },
}));

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: (...a) => apiMock(...a),
}));

const stopSpy = vi.fn();
const localCtrl = { transport: { stop: stopSpy, play: vi.fn(), pause: vi.fn(), seekAbs: vi.fn(), seekRel: vi.fn(), skipNext: vi.fn(), skipPrev: vi.fn() } };
vi.mock('../session/useSessionController.js', () => ({
  useSessionController: vi.fn(() => localCtrl),
}));

import { DispatchProvider, useDispatch } from './DispatchProvider.jsx';

function Probe({ mode = 'transfer' }) {
  const { dispatches, dispatchToTarget } = useDispatch();
  const rows = [...dispatches.values()].map((d) => `${d.dispatchId}:${d.status}`).join(',');
  return (
    <div>
      <span data-testid="rows">{rows}</span>
      <button data-testid="fire" onClick={() => dispatchToTarget({ targetIds: ['lr'], play: 'plex:1', mode })}>fire</button>
    </div>
  );
}

let capturedFilter = null;
let capturedCallback = null;
beforeEach(() => {
  apiMock.mockReset();
  stopSpy.mockReset();
  subscribeFn.mockReset().mockImplementation((filter, cb) => {
    capturedFilter = filter;
    capturedCallback = cb;
    return () => {};
  });
});

describe('DispatchProvider', () => {
  it('subscribes to homeline:* topics with a function filter', async () => {
    render(<DispatchProvider><Probe /></DispatchProvider>);
    expect(typeof capturedFilter).toBe('function');
    expect(capturedFilter({ topic: 'homeline:lr' })).toBe(true);
    expect(capturedFilter({ topic: 'homeline:other' })).toBe(true);
    expect(capturedFilter({ topic: 'device-state:lr' })).toBe(false);
    expect(capturedFilter({ topic: 'playback_state' })).toBe(false);
  });

  it('dispatchToTarget fires DaylightAPI with correct URL shape', async () => {
    apiMock.mockResolvedValueOnce({ ok: true, totalElapsedMs: 2000 });
    render(<DispatchProvider><Probe /></DispatchProvider>);
    act(() => { screen.getByTestId('fire').click(); });
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    expect(apiMock.mock.calls[0][0]).toMatch(/^api\/v1\/device\/lr\/load\?play=plex%3A1&dispatchId=/);
  });

  it('homeline STEP messages flow into the reducer without crashing', async () => {
    apiMock.mockImplementationOnce(() => new Promise(() => {})); // keeps status=running
    render(<DispatchProvider><Probe /></DispatchProvider>);
    act(() => { screen.getByTestId('fire').click(); });
    await waitFor(() => {
      const m = apiMock.mock.calls[0]?.[0]?.match(/dispatchId=([^&]+)/);
      expect(m?.[1]).toBeTruthy();
    });
    const dispatchId = apiMock.mock.calls[0][0].match(/dispatchId=([^&]+)/)[1];
    act(() => {
      capturedCallback({ topic: 'homeline:lr', type: 'wake-progress', dispatchId, step: 'power', status: 'running', elapsedMs: 50, ts: 't' });
    });
    expect(screen.getByTestId('rows').textContent).toContain(':running');
  });

  it('successful API response flips status=success', async () => {
    apiMock.mockResolvedValueOnce({ ok: true, totalElapsedMs: 1234 });
    render(<DispatchProvider><Probe /></DispatchProvider>);
    act(() => { screen.getByTestId('fire').click(); });
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toMatch(/:success/));
  });

  it('failed API response flips status=failed', async () => {
    apiMock.mockResolvedValueOnce({ ok: false, failedStep: 'power', error: 'WAKE_FAILED' });
    render(<DispatchProvider><Probe /></DispatchProvider>);
    act(() => { screen.getByTestId('fire').click(); });
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toMatch(/:failed/));
  });

  it('transfer mode: calls local transport.stop() on success', async () => {
    apiMock.mockResolvedValueOnce({ ok: true, totalElapsedMs: 500 });
    render(<DispatchProvider><Probe mode="transfer" /></DispatchProvider>);
    act(() => { screen.getByTestId('fire').click(); });
    await waitFor(() => expect(stopSpy).toHaveBeenCalled());
  });

  it('fork mode: does NOT call local transport.stop() on success', async () => {
    apiMock.mockResolvedValueOnce({ ok: true, totalElapsedMs: 500 });
    render(<DispatchProvider><Probe mode="fork" /></DispatchProvider>);
    act(() => { screen.getByTestId('fire').click(); });
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toMatch(/:success/));
    expect(stopSpy).not.toHaveBeenCalled();
  });
});

describe('DispatchProvider — idempotency', () => {
  beforeEach(() => { vi.useFakeTimers(); apiMock.mockResolvedValue({ ok: true, totalElapsedMs: 1 }); });
  afterEach(() => { vi.useRealTimers(); });

  it('deduplicates identical dispatches within the 5s window', async () => {
    render(<DispatchProvider><Probe /></DispatchProvider>);
    await act(async () => { screen.getByTestId('fire').click(); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    await act(async () => { screen.getByTestId('fire').click(); });
    // Still only one HTTP call
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('re-fires the dispatch after the window elapses', async () => {
    render(<DispatchProvider><Probe /></DispatchProvider>);
    await act(async () => { screen.getByTestId('fire').click(); });
    await act(async () => { vi.advanceTimersByTime(6000); });
    await act(async () => { screen.getByTestId('fire').click(); });
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('treats exactly 5000ms as outside the window (strict <)', async () => {
    render(<DispatchProvider><Probe /></DispatchProvider>);
    await act(async () => { screen.getByTestId('fire').click(); });
    await act(async () => { vi.advanceTimersByTime(5000); });
    await act(async () => { screen.getByTestId('fire').click(); });
    // 5000 - 0 = 5000, which is NOT < 5000, so the second dispatch should fire.
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
});
