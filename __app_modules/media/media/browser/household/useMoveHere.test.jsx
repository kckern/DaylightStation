// FIND.10a/AC3 — Move here adopts the screen's session on this device and
// stops that screen only after this device is natively playing the item and
// only if the screen is still on the same playback.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import { createRecoveryIdentity } from '../../../../../__capabilities/playback/browser/contracts.mjs';
import { createLocalSessionController } from '../session/LocalSessionController.js';
import { useMoveHere } from "./useMoveHere.js";
import { LocalSessionContext } from "../session/LocalSessionContext.js";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { PeekContext } from "../peek/PeekContext.js";
import { DispatchContext } from "../cast/DispatchProvider.jsx";

const remoteSnapshot = (revision = 3) => ({
  sessionId: 's', state: 'playing', position: 600,
  currentItem: { contentId: 'plex:9', title: 'Playing Thing', format: 'audio', duration: 900 },
  queue: { items: [{ queueItemId: 'q1', contentId: 'plex:9' }], currentIndex: 0, upNextCount: 0 },
  config: {}, meta: { ownerId: 'livingroom-tv', updatedAt: new Date().toISOString(), playbackOwner: {
    ownerInstanceId: 'owner-1', playbackRevision: revision, queueRevision: 0,
    sessionId: 's', contentId: 'plex:9', queueItemId: 'q1',
  } },
});

let fleetSnapshot; let observation; let local; let remote; let outcomes;
const playing = () => ({
  identity: { sessionId: 's', queueItemId: 'q1', contentId: 'plex:9' },
  nodeGeneration: 1, paused: false, readyState: 4, contentSeconds: 600, currentTime: 600, advancedObserved: true,
});
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
    recoveryIdentity: createRecoveryIdentity({ ownerId: 'local' }),
    lifecycle: { adoptSnapshot: vi.fn(() => {
      local.recoveryIdentity.beginVisit();
      observation = playing();
      return { ok: true };
    }) },
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

  it('observes a clock advance on the adopted decoder when playing preceded observation setup', async () => {
    local = createLocalSessionController({ clientId: 'me', sessionControls: { storage: null } });
    const { result } = harness();
    let pending;
    act(() => { pending = result.current('fleet:livingroom-tv'); });
    const decoder = { paused: false, seeking: false, ended: false, readyState: 4, currentTime: 600, duration: 900 };
    local.setPlayerHandle({ getMediaElement: () => decoder, getMountedContentId: () => 'plex:9', getMountedMediaGeneration: () => 1 });
    local.portability.getNativeObservation();
    local.onNativeObservationEvent(decoder, 'loadeddata');
    local.onNativeObservationEvent(decoder, 'timeupdate');
    expect(remote.transport.stop).not.toHaveBeenCalled();
    decoder.currentTime += 0.3;
    await act(async () => { local.onNativeObservationEvent(decoder, 'timeupdate'); });
    await expect(pending).resolves.toEqual({ ok: true });
    expect(remote.transport.stop).toHaveBeenCalledTimes(1);
    local.disposeRecovery();
  });

  it('leaves the source alone when another visit starts the same queue entry locally', async () => {
    local = createLocalSessionController({ clientId: 'me', sessionControls: { storage: null } });
    const { result } = harness();
    let pending;
    act(() => { pending = result.current('fleet:livingroom-tv'); });
    expect(local.getSnapshot().currentItem.contentId).toBe('plex:9');
    expect(remote.transport.stop).not.toHaveBeenCalled();

    // A second visit may reuse the same session and queue entry IDs.
    local.lifecycle.adoptSnapshot(fleetSnapshot, { autoplay: true });
    const decoder = { paused: false, seeking: false, ended: false, readyState: 4, currentTime: 600, duration: 900 };
    local.setPlayerHandle({ getMediaElement: () => decoder, getMountedContentId: () => 'plex:9', getMountedMediaGeneration: () => 2 });
    local.portability.getNativeObservation();
    local.onNativeObservationEvent(decoder, 'playing');
    decoder.currentTime += 0.3;
    local.onNativeObservationEvent(decoder, 'timeupdate');
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(remote.transport.stop).not.toHaveBeenCalled();
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'destination-changed' });
    local.disposeRecovery();
  });

  it('reports failure when the source stop has no acknowledgement', async () => {
    remote = undefined;
    const { result } = harness();
    await act(async () => {
      await expect(result.current('fleet:livingroom-tv')).resolves.toMatchObject({ ok: false, code: 'source-not-stopped' });
    });
    expect(outcomes.resolveLocal).toHaveBeenCalledWith('mv', expect.objectContaining({ phase: 'failed' }));
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
      local.recoveryIdentity.beginVisit();
      observation = playing();
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
