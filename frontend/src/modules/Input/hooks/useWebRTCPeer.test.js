// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebRTCPeer } from './useWebRTCPeer.js';

class FakeMediaStream {
  constructor(tracks = []) { this.tracks = [...tracks]; }
  getTracks() { return this.tracks; }
  addTrack(track) { this.tracks.push(track); }
}
class FakePC {
  constructor() {
    this.connectionState = 'new'; this.remoteDescription = null; this.localDescription = null;
    this.addIceCandidate = vi.fn(async () => {}); this.close = vi.fn(); this.addTrack = vi.fn();
  }
  createOffer(options) { return Promise.resolve({ type: 'offer', sdp: 'redacted', options }); }
  createAnswer() { return Promise.resolve({ type: 'answer', sdp: 'redacted' }); }
  setLocalDescription(value) { this.localDescription = value; return Promise.resolve(); }
  setRemoteDescription(value) { this.remoteDescription = value; return Promise.resolve(); }
  getTransceivers() { return []; }
  getSenders() { return []; }
  restartIce() {}
}

describe('useWebRTCPeer revision handling', () => {
  beforeEach(() => {
    globalThis.MediaStream = FakeMediaStream;
    globalThis.RTCSessionDescription = class { constructor(value) { Object.assign(this, value); } };
    globalThis.RTCIceCandidate = class { constructor(value) { Object.assign(this, value); } };
    globalThis.RTCPeerConnection = FakePC;
  });

  it('does not treat an SDP answer as a connected peer', async () => {
    const { result } = renderHook(() => useWebRTCPeer(new FakeMediaStream()));
    await act(async () => { await result.current.createOffer({ revision: 0 }); });
    await act(async () => { await result.current.handleAnswer({ type: 'answer', sdp: 'redacted' }, { revision: 0 }); });
    expect(result.current.connectionState).toBe('new');
    expect(result.current.pcRef.current.remoteDescription.type).toBe('answer');
  });

  it('discards candidates from prior peer revisions', async () => {
    const { result } = renderHook(() => useWebRTCPeer(new FakeMediaStream()));
    await act(async () => { await result.current.addIceCandidate({ candidate: 'old' }, 0); });
    await act(async () => { await result.current.handleOffer({ type: 'offer', sdp: 'redacted' }, { revision: 1 }); });
    expect(result.current.pcRef.current.addIceCandidate).not.toHaveBeenCalled();
    await act(async () => { await result.current.addIceCandidate({ candidate: 'stale' }, 0); });
    expect(result.current.pcRef.current.addIceCandidate).not.toHaveBeenCalled();
    await act(async () => { await result.current.addIceCandidate({ candidate: 'current' }, 1); });
    expect(result.current.pcRef.current.addIceCandidate).toHaveBeenCalledTimes(1);
  });

  it('increments revision for a full peer rebuild', async () => {
    const { result } = renderHook(() => useWebRTCPeer(new FakeMediaStream()));
    await act(async () => { await result.current.rebuild(2); });
    expect(result.current.revisionRef.current).toBe(2);
    expect(result.current.pcRef.current.localDescription.type).toBe('offer');
  });
});
