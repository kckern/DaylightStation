import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const socket = vi.hoisted(() => ({ listeners: new Set() }));
const fetchSession = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useWebSocket.js', async () => {
  const React = await import('react');
  return {
    useWebSocketSubscription: (_topic, callback) => React.useEffect(() => {
      socket.listeners.add(callback);
      return () => socket.listeners.delete(callback);
    }, [callback]),
  };
});
vi.mock('./api/sessionClient.js', () => ({ fetchSession }));

import { useGamingSession } from '../session-projection.mjs';

const snapshot = (revision, phase = `phase-${revision}`) => ({
  header: { session_id: 'game:one', revision },
  state: { phase },
  definition: { id: 'charades:family' },
});

describe('useGamingSession', () => {
  beforeEach(() => { fetchSession.mockReset(); socket.listeners.clear(); });
  afterEach(() => vi.restoreAllMocks());

  it('accepts the latest event refresh and ignores an older read that settles later', async () => {
    const reads = [];
    fetchSession.mockImplementation((_id, { signal } = {}) => new Promise((resolve, reject) => reads.push({ resolve, reject, signal })));
    const { result } = renderHook(() => useGamingSession('game:one'));
    await waitFor(() => expect(reads).toHaveLength(1));

    act(() => { for (const listener of socket.listeners) listener({ topic: 'gaming', kind: 'session-updated', sessionId: 'game:one' }); });
    await waitFor(() => expect(reads).toHaveLength(2));
    expect(reads[0].signal.aborted).toBe(true);

    await act(async () => reads[1].resolve(snapshot(2)));
    expect(result.current.session.header.revision).toBe(2);
    await act(async () => reads[0].resolve(snapshot(1)));
    expect(result.current.session.header.revision).toBe(2);
  });

  it('uses a parent reconnect snapshot and fences the pending transport read', async () => {
    let completeRead;
    fetchSession.mockImplementation(() => new Promise(resolve => { completeRead = resolve; }));
    const { result, rerender } = renderHook(({ recovered }) => useGamingSession('game:one', recovered), { initialProps: { recovered: null } });
    await waitFor(() => expect(fetchSession).toHaveBeenCalledTimes(1));

    rerender({ recovered: snapshot(3, 'reconnected') });
    await waitFor(() => expect(result.current.session?.header.revision).toBe(3));
    await act(async () => completeRead(snapshot(2, 'stale')));
    expect(result.current.session.state.phase).toBe('reconnected');
  });

  it('retires its read and event listener on unmount', async () => {
    let signal;
    fetchSession.mockImplementation((_id, options = {}) => { signal = options.signal; return new Promise(() => {}); });
    const view = renderHook(() => useGamingSession('game:one'));
    await waitFor(() => expect(fetchSession).toHaveBeenCalledTimes(1));
    expect(socket.listeners.size).toBe(1);

    view.unmount();
    expect(signal.aborted).toBe(true);
    expect(socket.listeners.size).toBe(0);
  });
});
