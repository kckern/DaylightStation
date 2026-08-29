// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaHealth } from './useMediaHealth.js';

const track = kind => ({ kind, readyState: 'live', muted: false });
const peerFor = kinds => {
  let checks = 0;
  const pc = { getStats: vi.fn(async () => {
    checks += 1;
    return new Map(kinds.map((kind, index) => [index, {
      type: 'inbound-rtp', kind, bytesReceived: checks * 100,
    }]));
  }) };
  return {
    pcRef: { current: pc },
    remoteStream: {
      getAudioTracks: () => kinds.includes('audio') ? [track('audio')] : [],
      getVideoTracks: () => kinds.includes('video') ? [track('video')] : [],
    },
  };
};

describe('useMediaHealth', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([
    [['audio'], true, false],
    [['video'], false, true],
    [['audio', 'video'], true, true],
  ])('verifies increasing inbound RTP for %j', async (kinds, audio, video) => {
    let frames = 0;
    const videoRef = { current: kinds.includes('video') ? {
      getVideoPlaybackQuality: () => ({ totalVideoFrames: ++frames }),
    } : null };
    const { result } = renderHook(() => useMediaHealth(peerFor(kinds), true, videoRef));
    await act(async () => { await vi.advanceTimersByTimeAsync(8_100); });
    expect(result.current).toEqual({ audio, video, verified: true });
  });

  it('marks ended or stalled tracks unhealthy after prior success', async () => {
    const peer = peerFor(['audio']);
    const videoRef = { current: null };
    const { result } = renderHook(() => useMediaHealth(peer, true, videoRef));
    await act(async () => { await vi.advanceTimersByTimeAsync(8_100); });
    expect(result.current.audio).toBe(true);
    peer.remoteStream.getAudioTracks = () => [{ readyState: 'ended', muted: false }];
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(result.current.audio).toBe(false);
  });

  it('resets RTP baselines when a full peer rebuild replaces the connection', async () => {
    const peer = peerFor(['audio']);
    const videoRef = { current: null };
    const { result } = renderHook(() => useMediaHealth(peer, true, videoRef));
    await act(async () => { await vi.advanceTimersByTimeAsync(8_100); });
    expect(result.current.audio).toBe(true);
    peer.pcRef.current = peerFor(['audio']).pcRef.current;
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(result.current.audio).toBe(true);
  });
});
