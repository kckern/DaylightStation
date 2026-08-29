// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  api: vi.fn(), onSignalEvent: null,
  signaling: { send: vi.fn(() => true), restartIce: vi.fn(), rebuild: vi.fn() },
  health: { audio: false, video: false, verified: false },
}));
vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: mocks.api }));
vi.mock('../../lib/logging/Logger.js', () => ({ default: () => ({
  child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}) }));
vi.mock('../../modules/Input/hooks/useCallSignaling.js', () => ({
  useCallSignaling: options => { mocks.onSignalEvent = options.onEvent; return mocks.signaling; },
}));
vi.mock('../../modules/Input/hooks/useMediaHealth.js', () => ({ useMediaHealth: () => mocks.health }));

import { useCallController } from './useCallController.js';

const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const peer = () => ({
  pcRef: { current: null }, reset: vi.fn(), connectionState: 'new',
  remoteStream: null, onIceCandidate: vi.fn(),
});
const flush = async () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('useCallController cancellation and budgets', () => {
  beforeEach(() => {
    vi.useFakeTimers(); mocks.api.mockReset(); mocks.signaling.send.mockClear();
    mocks.signaling.rebuild.mockReset(); mocks.signaling.restartIce.mockReset();
    mocks.health = { audio: false, video: false, verified: false };
    sessionStorage.clear();
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `id-${Math.random()}`) });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const reserveBody = { callId: 'call-1', attemptId: 'attempt', dispatchId: 'dispatch-1',
    topic: 'homeline-call:call-1', phoneCredential: 'credential' };

  async function startToProbe(result, target = { id: 'tv' }) {
    await flush();
    await act(async () => { result.current.start(target); });
    await flush();
    expect(result.current.state.value).toBe('probing');
  }

  it('cancels during probe without starting a wake', async () => {
    mocks.api.mockImplementation(async path => path.endsWith('/end') ? { ok: true } : reserveBody);
    const localPeer = peer();
    const { result } = renderHook(() => useCallController({ peer: localPeer, mediaStatus: 'ready', retryLocalMedia: vi.fn(), remoteVideoRef: { current: null } }));
    await startToProbe(result);
    await act(async () => { result.current.end('user_cancelled'); }); await flush();
    await act(async () => { vi.advanceTimersByTime(2_100); });
    expect(result.current.state.value).toBe('ended');
    expect(mocks.api.mock.calls.some(([path]) => path.endsWith('/wake'))).toBe(false);
  });

  it('aborts wake work and rejects its late completion after cancellation', async () => {
    const wake = deferred();
    mocks.api.mockImplementation((path, _body, _method, options) => {
      if (path.endsWith('/wake')) { wake.signal = options.signal; return wake.promise; }
      if (path.endsWith('/end')) return Promise.resolve({ ok: true });
      return Promise.resolve(reserveBody);
    });
    const localPeer = peer();
    const { result } = renderHook(() => useCallController({ peer: localPeer, mediaStatus: 'ready', retryLocalMedia: vi.fn(), remoteVideoRef: { current: null } }));
    await startToProbe(result);
    await act(async () => { vi.advanceTimersByTime(2_000); }); await flush();
    expect(result.current.state.value).toBe('waking');
    await act(async () => { result.current.end('user_cancelled'); }); await flush();
    expect(wake.signal.aborted).toBe(true);
    await act(async () => { wake.resolve({ ok: true, coldWake: true }); }); await flush();
    expect(result.current.state.value).toBe('ended');
    expect(localPeer.reset).toHaveBeenCalled();
  });

  it('turns a busy lease into an occupied state with no automatic retry', async () => {
    mocks.api.mockRejectedValue(Object.assign(new Error('busy'), { status: 409 }));
    const { result } = renderHook(() => useCallController({ peer: peer(), mediaStatus: 'ready', retryLocalMedia: vi.fn(), remoteVideoRef: { current: null } }));
    await flush();
    await act(async () => { result.current.start({ id: 'tv' }); }); await flush();
    expect(result.current.state.value).toBe('occupied');
    await act(async () => { vi.advanceTimersByTime(180_000); });
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });

  it('resumes the same call and stores only refresh identifiers', async () => {
    mocks.api.mockResolvedValue({ ...reserveBody, phonePeerId: 'phone-1', phoneCredential: 'rotated' });
    const { result } = renderHook(() => useCallController({ peer: peer(), mediaStatus: 'ready', retryLocalMedia: vi.fn(), remoteVideoRef: { current: null } }));
    await flush();
    await act(async () => { result.current.resume({ id: 'tv' }, 'call-1'); }); await flush();
    expect(mocks.api.mock.calls[0][0]).toContain('/calls/call-1/resume');
    expect(JSON.parse(sessionStorage.getItem('homeline.activeCall'))).toEqual({ callId: 'call-1', deviceId: 'tv' });
    expect(sessionStorage.getItem('homeline.activeCall')).not.toContain('rotated');
  });

  it('cancels signaling immediately and ignores late signaling events', async () => {
    mocks.api.mockImplementation(async path => path.endsWith('/end') ? { ok: true } : reserveBody);
    const { result } = renderHook(() => useCallController({ peer: peer(), mediaStatus: 'ready', retryLocalMedia: vi.fn(), remoteVideoRef: { current: null } }));
    await startToProbe(result);
    act(() => mocks.onSignalEvent({ type: 'tv-ready' }));
    expect(result.current.state.value).toBe('negotiating');
    act(() => result.current.end('user_cancelled')); await flush();
    expect(mocks.signaling.send).toHaveBeenCalledWith('hangup', { reason: 'user_cancelled' });
    act(() => mocks.onSignalEvent({ type: 'answered' }));
    expect(result.current.state.value).toBe('ended');
  });

  it('runs the bounded 5s grace, one ICE restart, one rebuild, then prompts', async () => {
    mocks.api.mockImplementation(async path => path.endsWith('/end') ? { ok: true } : reserveBody);
    const localPeer = peer(); localPeer.pcRef.current = { connectionState: 'disconnected' };
    const props = { connectionState: 'new' };
    const { result, rerender } = renderHook(({ connectionState }) => useCallController({
      peer: { ...localPeer, connectionState }, mediaStatus: 'ready', retryLocalMedia: vi.fn(), remoteVideoRef: { current: null },
    }), { initialProps: props });
    await startToProbe(result);
    act(() => result.current.dispatch({ type: 'TV_READY', attemptId: result.current.state.attemptId }));
    act(() => result.current.dispatch({ type: 'ANSWERED', attemptId: result.current.state.attemptId }));
    act(() => result.current.dispatch({ type: 'MEDIA_HEALTH', attemptId: result.current.state.attemptId, audio: true, video: true }));
    rerender({ connectionState: 'disconnected' });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(mocks.signaling.restartIce).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(mocks.signaling.rebuild).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(result.current.state.value).toBe('recovery_prompt');
    expect(mocks.signaling.restartIce).toHaveBeenCalledTimes(1);
    expect(mocks.signaling.rebuild).toHaveBeenCalledTimes(1);
  });

  it('serializes manual media recovery and applies its rebuild deadline', async () => {
    mocks.api.mockImplementation(async path => path.endsWith('/end') ? { ok: true } : reserveBody);
    const localPeer = peer(); localPeer.pcRef.current = { connectionState: 'disconnected' };
    const retryLocalMedia = vi.fn(async () => {});
    const { result } = renderHook(() => useCallController({ peer: localPeer, mediaStatus: 'ready',
      retryLocalMedia, remoteVideoRef: { current: null } }));
    await startToProbe(result);
    act(() => result.current.dispatch({ type: 'TV_READY', attemptId: result.current.state.attemptId }));
    act(() => result.current.dispatch({ type: 'ANSWERED', attemptId: result.current.state.attemptId }));
    act(() => result.current.dispatch({ type: 'MEDIA_HEALTH', attemptId: result.current.state.attemptId,
      audio: true, video: false }));
    await act(async () => {
      const first = result.current.retryMedia();
      const second = result.current.retryMedia();
      await Promise.all([first, second]);
    });
    expect(retryLocalMedia).toHaveBeenCalledTimes(1);
    expect(mocks.signaling.rebuild).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(result.current.state.value).toBe('recovery_prompt');
  });
});
