// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sent: [], subscriber: null, status: null, connected: true,
  service: {
    sendEphemeral: vi.fn(message => { mocks.sent.push(message); return true; }),
    subscribeAuthorized: vi.fn((_auth, callback) => { mocks.subscriber = callback; return vi.fn(); }),
    onStatusChange: vi.fn(callback => { mocks.status = callback; callback({ connected: mocks.connected }); return vi.fn(); }),
    getStatus: vi.fn(() => ({ connected: mocks.connected })),
    setAutoReloadEnabled: vi.fn(),
  },
}));
vi.mock('../../../services/WebSocketService.js', () => ({ default: mocks.service }));
vi.mock('../../../lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn() }) }) }));

import { useCallSignaling } from './useCallSignaling.js';

const session = { topic: 'homeline-call:c', callId: 'c', attemptId: 'a', peerId: 'p', credential: 'secret', peerRevision: 0 };
const peer = (overrides = {}) => ({
  onIceCandidate: vi.fn(), createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'redacted' })),
  handleOffer: vi.fn(), handleAnswer: vi.fn(), addIceCandidate: vi.fn(), restartIce: vi.fn(), rebuild: vi.fn(),
  connectionState: 'new', ...overrides,
});

describe('useCallSignaling reconnect behavior', () => {
  beforeEach(() => {
    mocks.sent = []; mocks.subscriber = null; mocks.status = null; mocks.connected = true;
    mocks.service.sendEphemeral.mockClear(); mocks.service.subscribeAuthorized.mockClear();
  });

  it('uses an exact authorized topic and handshakes only after authorization', async () => {
    renderHook(() => useCallSignaling({ role: 'phone', session, peer: peer(), onEvent: vi.fn() }));
    expect(mocks.service.subscribeAuthorized).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'homeline-call:c', credential: 'secret', role: 'phone', peerId: 'p',
    }), expect.any(Function));
    expect(mocks.sent).toEqual([]);
    await act(async () => { await mocks.subscriber({ topic: session.topic, type: 'homeline-authorize-ack', ok: true }); });
    expect(mocks.sent[0]).toMatchObject({ callId: 'c', attemptId: 'a', type: 'ready', revision: 0, sequence: 0 });
    expect(mocks.service.setAutoReloadEnabled).toHaveBeenCalledWith(false);
  });

  it('reauthorization status triggers a fresh handshake and permits a new offer', async () => {
    const localPeer = peer();
    renderHook(() => useCallSignaling({ role: 'phone', session, peer: localPeer, onEvent: vi.fn() }));
    await act(async () => { await mocks.subscriber({ topic: session.topic, type: 'homeline-authorize-ack', ok: true }); });
    await act(async () => { await mocks.subscriber({ ...session, role: 'tv', type: 'waiting', revision: 0, payload: {} }); });
    expect(localPeer.createOffer).toHaveBeenCalledTimes(1);
    act(() => mocks.status({ connected: false }));
    act(() => mocks.status({ connected: true }));
    expect(mocks.sent.filter(message => message.type === 'ready')).toHaveLength(1);
    await act(async () => { await mocks.subscriber({ topic: session.topic, type: 'homeline-authorize-ack', ok: true }); });
    expect(mocks.sent.filter(message => message.type === 'ready')).toHaveLength(2);
    await act(async () => { await mocks.subscriber({ ...session, role: 'tv', type: 'waiting', revision: 0, payload: {} }); });
    expect(localPeer.createOffer).toHaveBeenCalledTimes(2);
  });

  it('drops candidates from a stale revision before they reach the peer', async () => {
    const localPeer = peer();
    renderHook(() => useCallSignaling({ role: 'phone', session, peer: localPeer, onEvent: vi.fn() }));
    await act(async () => { await mocks.subscriber({ ...session, role: 'tv', type: 'candidate', revision: 1,
      payload: { candidate: { candidate: 'not-logged' } } }); });
    expect(localPeer.addIceCandidate).not.toHaveBeenCalled();
  });

  it('reauthorizes controls without renegotiating healthy peer media', async () => {
    const localPeer = peer({ connectionState: 'connected' });
    renderHook(() => useCallSignaling({ role: 'phone', session, peer: localPeer, onEvent: vi.fn() }));
    await act(async () => { await mocks.subscriber({ topic: session.topic, type: 'homeline-authorize-ack', ok: true }); });
    await act(async () => { await mocks.subscriber({ ...session, role: 'tv', type: 'waiting', revision: 0, payload: {} }); });
    expect(localPeer.createOffer).not.toHaveBeenCalled();
  });

  it('returns the new peer revision after a full rebuild', async () => {
    const localPeer = peer();
    localPeer.rebuild.mockResolvedValue({ type: 'offer', sdp: 'not-logged' });
    const { result } = renderHook(() => useCallSignaling({ role: 'phone', session, peer: localPeer, onEvent: vi.fn() }));
    let revision;
    await act(async () => { revision = await result.current.rebuild(); });
    expect(revision).toBe(1);
    expect(mocks.sent.at(-1)).toMatchObject({ type: 'offer', revision: 1, sequence: 0 });
  });
});
