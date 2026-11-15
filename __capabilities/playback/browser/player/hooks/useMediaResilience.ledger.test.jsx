import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaResilience } from './useMediaResilience.js';
import { createRecoveryLedger, _setSharedLedgerForTests } from '../lib/recoveryLedger.js';
import { createRecoveryIdentity } from '../lib/recovery/recoveryIdentity.js';
import { makeFakeEl } from './__testHelpers/fakeMediaEl.js';
import { STALL_JOLT_GRACE_MS, STALL_JOLT_STEP_MS } from '../lib/stallJolt.js';
let fakeNow, ledger;
const installLedger = (opts = {}) => {
  fakeNow = 1000000;
  ledger = createRecoveryLedger({ now: () => fakeNow, ...opts });
  _setSharedLedgerForTests(ledger);
};
const advance = ms => { fakeNow += ms; act(() => vi.advanceTimersByTime(ms)); };
const baseArgs = (overrides = {}) => ({
  onReload: vi.fn(), onExhausted: vi.fn(), meta: { src: 'https://example.test/stream/1', mediaKey: 'plex:1' },
  waitKey: 'test:ledger', playbackSessionKey: 'session-ledger-test', disabled: false,
  getMediaEl: () => null, seconds: 0, ...overrides,
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); _setSharedLedgerForTests(null); });
const complete = (args) => ledger.completeAction({ sessionKey: args.playbackSessionKey, actionId: ledger.snapshot(args.playbackSessionKey)?.inFlightActionId });
const spend = (hook, args, count) => {
  for (let i = 0; i < count; i++) {
    act(() => hook.result.current._testTriggerRecovery('playback-stalled'));
    complete(args); advance(4000);
  }
};
describe('useMediaResilience shared incident ownership', () => {
  it('denies overlapping actions, then enforces minimum spacing after completion', () => {
    installLedger(); const args = baseArgs();
    const hook = renderHook(() => useMediaResilience(args));
    act(() => hook.result.current._testTriggerRecovery('playback-stalled'));
    advance(4000);
    act(() => hook.result.current._testTriggerRecovery('playback-stalled'));
    expect(args.onReload).toHaveBeenCalledTimes(1);
    complete(args);
    act(() => hook.result.current._testTriggerRecovery('playback-stalled'));
    expect(args.onReload).toHaveBeenCalledTimes(2);
    expect(args.onReload.mock.calls[1][0].actionId).not.toBe(args.onReload.mock.calls[0][0].actionId);
  });
  it('notifies exhaustion once after three shared actions even if decoder identity changes', () => {
    installLedger(); const args = baseArgs();
    const hook = renderHook(props => useMediaResilience(props), { initialProps: args });
    spend(hook, args, 3);
    act(() => hook.rerender({ ...args, waitKey: 'new-decoder' }));
    act(() => hook.result.current._testTriggerRecovery('playback-stalled'));
    act(() => hook.result.current._testTriggerRecovery('playback-stalled'));
    expect(args.onReload).toHaveBeenCalledTimes(3);
    expect(args.onExhausted).toHaveBeenCalledTimes(1);
    expect(args.onExhausted).toHaveBeenCalledWith(expect.objectContaining({ attempts: 3 }));
  });
  it('does not erase accounting after brief genuine forward progress or pause', () => {
    installLedger(); const args = baseArgs({ seconds: 100 });
    const hook = renderHook(props => useMediaResilience(props), { initialProps: args });
    spend(hook, args, 1);
    act(() => hook.rerender({ ...args, seconds: 103 }));
    expect(ledger.snapshot(args.playbackSessionKey).count).toBe(1);
    act(() => hook.rerender({ ...args, seconds: 103, isPaused: true }));
    advance(60000);
    expect(ledger.snapshot(args.playbackSessionKey).count).toBe(1);
  });
  it('closes an incident only after sixty eligible seconds of real native advancement', () => {
    installLedger();
    const el = makeFakeEl({ currentTime: 100, playbackRate: 1, readyState: 4, paused: false });
    const args = baseArgs({ getMediaEl: () => el, seconds: 100 });
    const hook = renderHook(() => useMediaResilience(args));
    act(() => hook.result.current._testTriggerRecovery('playback-stalled'));
    for (let i = 0; i < 119; i++) { el.currentTime += 0.5; advance(500); }
    expect(ledger.snapshot(args.playbackSessionKey)).toMatchObject({ count: 1, rollingCount: 1, inFlightActionId: null });
    for (let i = 0; i < 3; i++) { el.currentTime += 0.5; advance(500); }
    expect(ledger.snapshot(args.playbackSessionKey)).toMatchObject({ count: 0, rollingCount: 1 });
  });
  it('keeps owner-managed budget on renderer hook unmount', () => {
    installLedger(); const args = baseArgs({ recoveryIdentity: createRecoveryIdentity({ ownerId: 'test-owner' }) });
    const hook = renderHook(() => useMediaResilience(args));
    spend(hook, args, 1);
    hook.unmount();
    expect(ledger.snapshot(args.playbackSessionKey).count).toBe(1);
  });
  it('explicit Retry debits a fresh incident but cannot erase six rolling actions', () => {
    installLedger(); const args = baseArgs(); const hook = renderHook(() => useMediaResilience(args));
    spend(hook, args, 3);
    act(() => hook.result.current.retryFromExhausted());
    expect(ledger.snapshot(args.playbackSessionKey)).toMatchObject({ count: 1, rollingCount: 4 });
    complete(args); advance(4000); spend(hook, args, 2);
    act(() => hook.result.current.retryFromExhausted());
    expect(args.onReload).toHaveBeenCalledTimes(6);
    expect(ledger.snapshot(args.playbackSessionKey)).toMatchObject({ rollingCount: 6 });
    expect(ledger.snapshot(args.playbackSessionKey).retryAfterMs).toBeGreaterThan(0);
  });
  it('expires missing-native-node reservations on fresh owner heartbeats and remains capped', () => {
    installLedger(); const args = baseArgs(); const hook = renderHook(() => useMediaResilience(args));
    for (let attempt = 0; attempt < 3; attempt++) {
      act(() => hook.result.current._testTriggerRecovery('playback-stalled'));
      for (let tick = 0; tick < 33; tick++) advance(500);
      expect(ledger.snapshot(args.playbackSessionKey).inFlightActionId).toBeNull();
    }
    act(() => hook.result.current._testTriggerRecovery('playback-stalled'));
    expect(args.onReload).toHaveBeenCalledTimes(3);
    expect(args.onExhausted).toHaveBeenCalledTimes(1);
    expect(ledger.snapshot(args.playbackSessionKey).count).toBe(3);
  });
  it('manual reload respects the shared in-flight slot and minimum spacing', () => {
    installLedger(); const controllerRef = { current: null }; const args = baseArgs({ controllerRef });
    const hook = renderHook(() => useMediaResilience(args));
    spend(hook, args, 1);
    act(() => controllerRef.current.forceReload({ reason: 'fitness-stalled-seek', seekToIntentMs: 123456 }));
    expect(args.onReload).toHaveBeenLastCalledWith(expect.objectContaining({ seekToIntentMs: 123456 }));
    act(() => controllerRef.current.forceReload({ reason: 'fitness-manual' }));
    expect(args.onReload).toHaveBeenCalledTimes(2);
  });
});
// ---------------------------------------------------------------------------
// (g) EOF is not a stall (2026-07-10 soak defect #3)
//
// plex:674553 reached EOF without firing `ended`. joltIntentRef captured
// currentTime == duration, so every jolt re-seeked to the end and re-stalled.
// ---------------------------------------------------------------------------

describe('useMediaResilience — end-of-content is never jolted', () => {
  // A media element at a given position. Uses makeFakeEl (not a bare object)
  // because usePlaybackHealth attaches media-event listeners to whatever
  // getMediaEl returns — a plain object without addEventListener throws inside
  // its effect. The jolt path itself reads el.currentTime / el.duration /
  // el.ended, all of which makeFakeEl carries.
  const elAt = ({ currentTime, duration, ended = false }) =>
    makeFakeEl({ currentTime, duration, ended, paused: false, seeking: false });

  const renderStalledAt = (el) => {
    const initial = baseArgs({ waitKey: 'wk-1', externalStalled: false, getMediaEl: () => el });
    const hook = renderHook((props) => useMediaResilience(props), { initialProps: initial });
    act(() => { hook.rerender({ ...initial, seconds: 5 }); });
    act(() => { hook.rerender({ ...initial, seconds: 5, waitKey: 'wk-2', externalStalled: true }); });
    return initial;
  };

  it('does NOT fire a jolt when frozen at duration', () => {
    installLedger({ cooldownMs: 0 });
    const args = renderStalledAt(elAt({ currentTime: 677.418, duration: 677.418 }));
    args.onReload.mockClear();

    advance(STALL_JOLT_GRACE_MS + STALL_JOLT_STEP_MS * 3);
    expect(args.onReload).not.toHaveBeenCalled();
    expect(ledger.snapshot(args.playbackSessionKey)?.count ?? 0).toBe(0);
  });

  it('does NOT fire a jolt when the element reports ended', () => {
    installLedger({ cooldownMs: 0 });
    const args = renderStalledAt(elAt({ currentTime: 12, duration: 677.418, ended: true }));
    args.onReload.mockClear();

    advance(STALL_JOLT_GRACE_MS + STALL_JOLT_STEP_MS);
    expect(args.onReload).not.toHaveBeenCalled();
  });

  it('DOES fire a jolt for a genuine mid-stream stall', () => {
    installLedger({ cooldownMs: 0 });
    // The real incident's stall position: 659.5s of 677.4s — 17.9s of content left.
    const args = renderStalledAt(elAt({ currentTime: 659.5, duration: 677.418 }));
    args.onReload.mockClear();

    advance(STALL_JOLT_GRACE_MS);
    expect(args.onReload).toHaveBeenCalledTimes(1);
    expect(args.onReload).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'stall-jolt-refresh-url' })
    );
  });
});

describe('held Retry controller', () => {
  it('projects a rolling delay and exposes a paused Retry on the owner controller', () => {
    installLedger();
    const controllerRef = { current: null };
    const identity = createRecoveryIdentity({ ownerId: 'held-owner' });
    const args = baseArgs({ controllerRef, recoveryIdentity: identity, seconds: 321, isPaused: true, pauseIntent: 'user' });
    const hook = renderHook(() => useMediaResilience(args));
    spend(hook, args, 3);
    act(() => hook.result.current.retryFromExhausted()); complete(args); advance(4000);
    spend(hook, args, 2);
    act(() => hook.result.current.retryFromExhausted());
    expect(hook.result.current.overlayProps.retryAfterMs).toBeGreaterThan(500000);
    const before = args.onReload.mock.calls.length;
    act(() => controllerRef.current.retryFromExhausted());
    expect(args.onReload).toHaveBeenCalledTimes(before);
    advance(600000);
    act(() => controllerRef.current.retryFromExhausted());
    expect(args.onReload).toHaveBeenLastCalledWith(expect.objectContaining({ seekToIntentMs: 321000, userInitiated: true }));
    expect(args.onReload.mock.calls.at(-1)[0].resumePlayback).not.toBe(true);
  });
});
