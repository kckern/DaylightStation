// FIND.10a/AC3 — Move here adopts the screen's session on this device and
// stops that screen only after this device is natively playing the item and
// only if the screen is still on the same playback.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import { useMoveHere } from './useMoveHere.js';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { PeekContext } from '../peek/PeekContext.js';
import { DispatchContext } from '../cast/DispatchProvider.jsx';

const remoteSnapshot = (revision = 3) => ({
  sessionId: 's', state: 'playing', position: 600,
  currentItem: { contentId: 'plex:9', title: 'Playing Thing' },
  queue: { items: [{ queueItemId: 'q1', contentId: 'plex:9' }], currentIndex: 0, upNextCount: 0 },
  config: {}, meta: { ownerId: 'livingroom-tv', playbackOwner: { ownerInstanceId: 'owner-1', playbackRevision: revision } },
});

let fleetSnapshot; let observation; let local; let remote; let outcomes;
function harness() {
  const wrapper = ({ children }) => (
    <LocalSessionContext.Provider value={{ controller: local }}>
      <FleetContext.Provider value={{ store: { getEntry: () => ({ snapshot: fleetSnapshot }) } }}>
        <PeekContext.Provider value={{ getController: () => remote }}>
          <DispatchContext.Provider value={outcomes}>{children}</DispatchContext.Provider>
        </PeekContext.Provider>
      </FleetContext.Provider>
    </LocalSessionContext.Provider>
  );
  return renderHook(() => useMoveHere(), { wrapper });
}

beforeEach(() => {
  vi.useFakeTimers();
  fleetSnapshot = remoteSnapshot();
  observation = null;
  local = {
    lifecycle: { adoptSnapshot: vi.fn(() => { observation = { identity: { contentId: 'plex:9' }, paused: false, readyState: 4 }; return { ok: true }; }) },
    portability: { getNativeObservation: () => observation, subscribeNative: () => () => {} },
  };
  remote = { transport: { stop: vi.fn(() => Promise.resolve({ ok: true })) } };
  outcomes = { recordLocal: vi.fn(() => 'mv'), resolveLocal: vi.fn() };
});
afterEach(() => vi.useRealTimers());

describe('useMoveHere', () => {
  it('adopts here, waits for native playing evidence, then stops the screen', async () => {
    const { result } = harness();
    let outcome;
    await act(async () => { outcome = await result.current('fleet:livingroom-tv', { contentId: 'plex:9', title: 'Playing Thing' }); });
    expect(local.lifecycle.adoptSnapshot).toHaveBeenCalledWith(expect.objectContaining({ currentItem: expect.objectContaining({ contentId: 'plex:9' }) }), { autoplay: true });
    expect(remote.transport.stop).toHaveBeenCalled();
    expect(outcome).toEqual({ ok: true });
    expect(outcomes.recordLocal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'moveHere', phase: 'running', command: expect.objectContaining({ sourceId: 'livingroom-tv', sourceName: 'Living Room TV' }) }));
    expect(outcomes.resolveLocal).toHaveBeenCalledWith('mv', { phase: 'confirmed' });
  });

  it('never stops the screen when this device does not start playing', async () => {
    local.lifecycle.adoptSnapshot = vi.fn(() => ({ ok: true }));
    const { result } = harness();
    let pending;
    act(() => { pending = result.current('fleet:livingroom-tv', { contentId: 'plex:9' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(21_000); });
    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    expect(remote.transport.stop).not.toHaveBeenCalled();
    expect(outcomes.resolveLocal).toHaveBeenCalledWith('mv', expect.objectContaining({ phase: 'failed' }));
  });

  it('does not stop the screen when its playback changed meanwhile', async () => {
    local.lifecycle.adoptSnapshot = vi.fn(() => {
      observation = { identity: { contentId: 'plex:9' }, paused: false, readyState: 4 };
      fleetSnapshot = remoteSnapshot(4);
      return { ok: true };
    });
    const { result } = harness();
    let outcome;
    await act(async () => { outcome = await result.current('fleet:livingroom-tv', { contentId: 'plex:9' }); });
    expect(outcome.ok).toBe(false);
    expect(remote.transport.stop).not.toHaveBeenCalled();
  });

  it('a second tap while a move is in flight does nothing', async () => {
    local.lifecycle.adoptSnapshot = vi.fn(() => ({ ok: true }));
    const { result } = harness();
    let first; let second;
    act(() => { first = result.current('fleet:livingroom-tv', { contentId: 'plex:9' }); });
    await act(async () => { second = await result.current('fleet:livingroom-tv', { contentId: 'plex:9' }); });
    expect(second).toMatchObject({ ok: false, code: 'IN_FLIGHT' });
    expect(local.lifecycle.adoptSnapshot).toHaveBeenCalledTimes(1);
    expect(outcomes.recordLocal).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(21_000); });
    await first;
  });

  it('two surfaces (separate hook instances) cannot start two moves of one screen', async () => {
    local.lifecycle.adoptSnapshot = vi.fn(() => ({ ok: true }));
    const a = harness();
    const b = harness();
    let first; let second;
    act(() => { first = a.result.current('fleet:livingroom-tv', { contentId: 'plex:9' }); });
    await act(async () => { second = await b.result.current('fleet:livingroom-tv', { contentId: 'plex:9' }); });
    expect(second).toMatchObject({ ok: false, code: 'IN_FLIGHT' });
    expect(local.lifecycle.adoptSnapshot).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(21_000); });
    await first;
  });

  it('refuses when the screen is no longer playing that item', async () => {
    fleetSnapshot = { ...remoteSnapshot(), currentItem: { contentId: 'plex:other' } };
    const { result } = harness();
    let outcome;
    await act(async () => { outcome = await result.current('fleet:livingroom-tv', { contentId: 'plex:9' }); });
    expect(outcome.code).toBe('SOURCE_CHANGED');
    expect(local.lifecycle.adoptSnapshot).not.toHaveBeenCalled();
  });
});
