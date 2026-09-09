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
const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), sampled: vi.fn() }));
vi.mock('../../../lib/logging/Logger.js', () => ({ default: () => ({ child: () => logs }) }));

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
    mocks.service.sendEphemeral.mockImplementation(message => { mocks.sent.push(message); return true; });
    logs.info.mockClear(); logs.warn.mockClear(); logs.sampled.mockClear();
  });

  const waiting = () => mocks.subscriber({ ...session, role: 'tv', type: 'waiting', revision: 0, payload: {} });
  const answer = (revision = 0) => mocks.subscriber({ ...session, role: 'tv', type: 'answer', revision, payload: { description: { type: 'answer', sdp: 'redacted' } } });

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

  it('re-offers on the same revision for every fresh waiting until an answer lands', async () => {
    const localPeer = peer();
    renderHook(() => useCallSignaling({ role: 'phone', session, peer: localPeer, onEvent: vi.fn() }));
    await act(async () => { await waiting(); });
    await act(async () => { await waiting(); });
    expect(localPeer.createOffer).toHaveBeenCalledTimes(2);
    const offers = mocks.sent.filter(message => message.type === 'offer');
    expect(offers.map(message => message.revision)).toEqual([0, 0]);
    expect(offers[1].sequence).toBeGreaterThan(offers[0].sequence);
  });

  it('ignores a stray waiting after an accepted answer while ICE is still connecting', async () => {
    const localPeer = peer({ connectionState: 'connecting' });
    const onEvent = vi.fn();
    renderHook(() => useCallSignaling({ role: 'phone', session, peer: localPeer, onEvent }));
    await act(async () => { await waiting(); });
    await act(async () => { await answer(); });
    expect(onEvent).toHaveBeenCalledWith({ type: 'answered' });
    await act(async () => { await waiting(); });
    expect(localPeer.createOffer).toHaveBeenCalledTimes(1);
  });

  it('lets a rebuild offer again on the new revision after an answer', async () => {
    const localPeer = peer();
    localPeer.rebuild.mockResolvedValue({ type: 'offer', sdp: 'redacted' });
    const { result } = renderHook(() => useCallSignaling({ role: 'phone', session, peer: localPeer, onEvent: vi.fn() }));
    await act(async () => { await waiting(); });
    await act(async () => { await answer(); });
    await act(async () => { await result.current.rebuild(); });
    await act(async () => { await mocks.subscriber({ ...session, role: 'tv', type: 'waiting', revision: 1, payload: {} }); });
    expect(localPeer.createOffer).toHaveBeenCalledTimes(2);
    expect(mocks.sent.at(-1)).toMatchObject({ type: 'offer', revision: 1 });
  });

  it('warns when a signalling message is dropped instead of losing it silently', async () => {
    const localPeer = peer();
    renderHook(() => useCallSignaling({ role: 'phone', session, peer: localPeer, onEvent: vi.fn() }));
    mocks.service.sendEphemeral.mockImplementationOnce(() => false);
    await act(async () => { await waiting(); });
    expect(logs.warn).toHaveBeenCalledWith('signaling.dropped', expect.objectContaining({ callId: 'c', type: 'offer', peerRevision: 0 }));
    expect(logs.info).toHaveBeenCalledWith('signaling.offer', expect.objectContaining({ delivered: false }));
    expect(logs.sampled).not.toHaveBeenCalled();
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
