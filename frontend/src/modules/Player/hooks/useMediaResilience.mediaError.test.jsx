import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaResilience } from './useMediaResilience.js';
import { createRecoveryLedger, _setSharedLedgerForTests } from '../lib/recoveryLedger.js';
import { makeFakeEl } from './__testHelpers/fakeMediaEl.js';
import { STALL_JOLT_GRACE_MS } from '../lib/stallJolt.js';

// ---------------------------------------------------------------------------
// useMediaResilience — a fatal media error is a stuck cause.
//
// Regression test for 2026-09-03: the container serving the proxied stream URL
// was recreated mid-playback, the HTTP body feeding <audio> died, Chromium
// raised PIPELINE_ERROR_READ (MEDIA_ERR_NETWORK) and paused the element. It
// fired `error` + `pause` and NOTHING else — no `waiting`, no `stalled` — so
// every starvation signal in `isStuck` stayed false and the jolt ladder never
// armed. Playback sat silent for five minutes with 284s still buffered.
// ---------------------------------------------------------------------------

// Injectable ledger clock, independent of vitest's Date faking (same idiom as
// useMediaResilience.ledger.test.jsx). Starts >0 so the ledger's lastAt=0
// "never attempted" sentinel can't collide with t=0.
let fakeNow;

const installLedger = (opts = {}) => {
  fakeNow = 1_000_000;
  _setSharedLedgerForTests(createRecoveryLedger({ now: () => fakeNow, ...opts }));
};

// Advance both the hook's timers (setTimeout rungs, the advance poll) and the
// ledger clock.
const advance = (ms) => {
  fakeNow += ms;
  act(() => { vi.advanceTimersByTime(ms); });
};

// NOTE: meta deliberately lacks mediaType/mediaUrl/plex/contentId keys so
// shouldArmStartupDeadline stays false — no phantom startup-deadline recovery
// firing while we advance fake timers.
const baseArgs = (overrides = {}) => ({
  onReload: vi.fn(),
  onExhausted: vi.fn(),
  meta: { src: 'https://example.test/proxy/plex/stream/1', mediaKey: 'plex:1' },
  waitKey: 'test:media-error',
  playbackSessionKey: 'session-media-error',
  disabled: false,
  getMediaEl: () => null,
  seconds: 0,
  isPaused: false,
  isSeeking: false,
  pauseIntent: null,
  ...overrides
});

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); _setSharedLedgerForTests(null); });

describe('useMediaResilience — a mid-playback media error is a stuck cause', () => {
  it('jolts when the pipeline dies with a healthy buffer and no waiting/stalled event', () => {
    installLedger();
    // The incident's shape: 1037.93s into a 1399.11s track, with 284.92s still
    // buffered ahead of the playhead. The buffered range matters — a starved
    // element would be `{ length: 0 }`, which is the opposite failure and could
    // let this pass for the wrong reason.
    const el = makeFakeEl({
      currentTime: 1037.93,
      duration: 1399.11,
      paused: false,
      buffered: { length: 1, start: () => 0, end: () => 1322.85 }
    });
    const args = baseArgs({ getMediaEl: () => el, seconds: 1037.93 });

    const { rerender } = renderHook(() => useMediaResilience(args));

    // Establish "has ever played" — the ladder only arms mid-playback.
    act(() => { el._fire('playing'); });
    advance(1000);

    // The proxy dies. NO 'waiting', NO 'stalled' — that is the whole point.
    act(() => { el.error = { code: 2, message: 'PIPELINE_ERROR_READ' }; el._fire('error'); });
    el.paused = true;
    rerender();

    expect(args.onReload).not.toHaveBeenCalled(); // ladder waits out its grace period

    advance(STALL_JOLT_GRACE_MS + 100);

    expect(args.onReload).toHaveBeenCalled();
    // Rung 0 re-mints the stream URL — right for a dead proxy connection.
    expect(args.onReload.mock.calls[0][0]).toMatchObject({
      reason: 'stall-jolt-refresh-url',
      refreshUrl: true,
      forceRemount: false
    });
  });

  it('still jolts when the pause is reported to the hook (isPaused true, pauseIntent null)', () => {
    // The audio/video path never supplies pauseIntent — only ContentScroller's
    // useMediaReporter does — so a reported pause arrives unclassified. Without
    // the !mediaErrorStoppedPlayback guard this reads as a USER pause, userIntent goes to
    // `paused`, the monitoring effect hard-returns, and the ladder never arms.
    // Today the ladder is reachable only because `timeupdate` (the sole emit
    // site for SinglePlayer's metrics) stops at the error, leaving isPaused
    // stale-false. This test pins the behaviour that must survive a later
    // timeupdate, or anyone wiring pause-driven metrics. See plan decision 4d.
    installLedger();
    const el = makeFakeEl({
      currentTime: 1037.93,
      duration: 1399.11,
      paused: false,
      buffered: { length: 1, start: () => 0, end: () => 1322.85 }
    });
    const args = baseArgs({ getMediaEl: () => el, seconds: 1037.93 });

    const { rerender } = renderHook(() => useMediaResilience(args));

    // Establish "has ever played" — the ladder only arms mid-playback, and the
    // flag is set inside the monitoring effect, downstream of the paused
    // hard-return, so it has to be earned while still reported as playing.
    act(() => { el._fire('playing'); });
    advance(1000);

    // The proxy dies. NO 'waiting', NO 'stalled'. The buffer stays healthy —
    // a starved element would be `{ length: 0 }`, the opposite failure.
    act(() => { el.error = { code: 2, message: 'PIPELINE_ERROR_READ' }; el._fire('error'); });
    el.paused = true;
    expect(el.buffered.length).toBe(1);
    expect(el.buffered.end(0)).toBeGreaterThan(el.currentTime);
    // ...and THIS time the pause reaches the hook, unclassified.
    args.isPaused = true;
    args.pauseIntent = null;
    rerender();

    expect(args.onReload).not.toHaveBeenCalled(); // ladder waits out its grace period

    advance(STALL_JOLT_GRACE_MS + 100);

    expect(args.onReload).toHaveBeenCalled();
    expect(args.onReload.mock.calls[0][0]).toMatchObject({ reason: 'stall-jolt-refresh-url' });
  });

  it('does not jolt when the user pauses and there is no media error', () => {
    // Same reported shape — isPaused true, pauseIntent null — but NO error
    // fired. That is still a user pause, and the guard must not make the
    // player un-pausable: no jolt, however long we wait.
    installLedger();
    const el = makeFakeEl({
      currentTime: 1037.93,
      duration: 1399.11,
      paused: false,
      buffered: { length: 1, start: () => 0, end: () => 1322.85 }
    });
    const args = baseArgs({ getMediaEl: () => el, seconds: 1037.93 });

    const { rerender } = renderHook(() => useMediaResilience(args));

    act(() => { el._fire('playing'); });
    advance(1000);

    // The user hits pause. No error, no waiting, no stalled.
    act(() => { el._fire('pause'); });
    el.paused = true;
    args.isPaused = true;
    args.pauseIntent = null;
    rerender();

    advance(STALL_JOLT_GRACE_MS + 100);

    expect(args.onReload).not.toHaveBeenCalled();
  });

  it('stays quiet when the error arrives on an ALREADY-paused element', () => {
    // Ordering is the whole test: the user pauses FIRST, and only then does the
    // proxy die under a parked element. Nothing stopped playing, so there is
    // nothing to recover right now — and rung 0 for audio falls through to a
    // remount of `<audio src autoPlay>`, which would restart a paused bedtime
    // story by itself. What happens AFTERWARDS is not "deferred recovery" on
    // every path — see the next test for what is actually true.
    installLedger();
    const el = makeFakeEl({
      currentTime: 1037.93,
      duration: 1399.11,
      paused: false,
      buffered: { length: 1, start: () => 0, end: () => 1322.85 }
    });
    const args = baseArgs({ getMediaEl: () => el, seconds: 1037.93 });

    const { rerender } = renderHook(() => useMediaResilience(args));

    act(() => { el._fire('playing'); });
    advance(1000);

    // 1. The user pauses.
    act(() => { el.paused = true; el._fire('pause'); });
    args.isPaused = true;
    args.pauseIntent = null;
    rerender();

    // A human interval passes — far outside the coincidence window that tells an
    // error-induced pause from a deliberate one.
    advance(60_000);

    // 2. THEN the proxy dies, under an element that is already parked.
    act(() => { el.error = { code: 2, message: 'PIPELINE_ERROR_READ' }; el._fire('error'); });
    rerender();

    advance(STALL_JOLT_GRACE_MS + 100);

    expect(args.onReload).not.toHaveBeenCalled();
  });

  it('jolts even if the pause event beats the error event', () => {
    // Insurance against browser dispatch order, which we have NOT verified
    // across engines: if 'pause' lands first, the element already reads
    // `paused` by the time the error handler runs. The two are dispatched in
    // the same task, so the pause's age — not its order — is what separates it
    // from a deliberate one. Without that, a pause-first browser would take the
    // fix out silently, which is exactly the failure mode 4d exists to prevent.
    installLedger();
    const el = makeFakeEl({
      currentTime: 1037.93,
      duration: 1399.11,
      paused: false,
      buffered: { length: 1, start: () => 0, end: () => 1322.85 }
    });
    const args = baseArgs({ getMediaEl: () => el, seconds: 1037.93 });

    const { rerender } = renderHook(() => useMediaResilience(args));

    act(() => { el._fire('playing'); });
    advance(1000);

    // Pause FIRST, error second, same instant — the reverse of the order the
    // other tests use.
    act(() => {
      el.paused = true;
      el._fire('pause');
      el.error = { code: 2, message: 'PIPELINE_ERROR_READ' };
      el._fire('error');
    });
    args.isPaused = true;
    args.pauseIntent = null;
    rerender();

    advance(STALL_JOLT_GRACE_MS + 100);

    expect(args.onReload).toHaveBeenCalled();
    expect(args.onReload.mock.calls[0][0]).toMatchObject({ reason: 'stall-jolt-refresh-url' });
  });

  it('a paused-then-errored element stays quiet until isPaused flips back to false', () => {
    // Two assertions, and the gap between them is the point.
    //
    // (a) While the reported `isPaused` stays stuck true, the ladder never arms.
    //     THIS IS THE AUDIO/VIDEO PATH'S REALITY, not a transient: `isPaused`
    //     reaches the hook only via SinglePlayer.handleProgress, fed by
    //     `onProgress`, whose sole call site is `onTimeUpdate`
    //     (useCommonMediaController.js:874-889) — and a dead pipeline cannot
    //     fire `timeupdate`. Pressing play cannot unfreeze it. Such an item
    //     recovers only when it is re-dispatched.
    //
    // (b) IF something does flip `isPaused` back to false, the latched error
    //     arms the ladder immediately. That is the mechanism, and it is what
    //     ContentScroller gets for free — useMediaReporter reports from the
    //     element's own play/pause listeners, so the flip actually happens
    //     there.
    //
    // So this test pins a MECHANISM, not an end-to-end guarantee. Anyone
    // tempted to read (b) as "audio recovers when the user presses play"
    // should re-read (a) first.
    installLedger();
    const el = makeFakeEl({
      currentTime: 1037.93,
      duration: 1399.11,
      paused: false,
      buffered: { length: 1, start: () => 0, end: () => 1322.85 }
    });
    const args = baseArgs({ getMediaEl: () => el, seconds: 1037.93 });

    const { rerender } = renderHook(() => useMediaResilience(args));

    act(() => { el._fire('playing'); });
    advance(1000);

    // The user pauses, then the stream dies under the parked element.
    act(() => { el.paused = true; el._fire('pause'); });
    args.isPaused = true;
    args.pauseIntent = null;
    rerender();
    advance(60_000);
    act(() => { el.error = { code: 2, message: 'PIPELINE_ERROR_READ' }; el._fire('error'); });
    rerender();

    // (a) isPaused stuck true — the audio path's frozen state. Nothing happens,
    //     however long we wait.
    advance(STALL_JOLT_GRACE_MS + 100);
    expect(args.onReload).not.toHaveBeenCalled();

    // (b) Something reports the element as un-paused. No `playing` event fires:
    //     the pipeline is dead, so the errorCode is still latched.
    act(() => { el.paused = false; });
    args.isPaused = false;
    rerender();

    advance(STALL_JOLT_GRACE_MS + 100);
    expect(args.onReload).toHaveBeenCalled();
    expect(args.onReload.mock.calls[0][0]).toMatchObject({ reason: 'stall-jolt-refresh-url' });
  });

  it('stays quiet on a long-parked element even if the wall clock steps backwards', () => {
    // The pause's age is measured on the MONOTONIC clock. With Date.now() an NTP
    // step backwards makes the elapsed time negative, which satisfies the
    // coincidence window and classifies an hour-old pause as error-stopped —
    // resuming a paused track by itself, the exact regression the narrowing
    // exists to prevent. Verified both ways: with Date.now() this test sees
    // onReload called once; with performance.now() it sees zero.
    installLedger();
    const el = makeFakeEl({
      currentTime: 1037.93,
      duration: 1399.11,
      paused: false,
      buffered: { length: 1, start: () => 0, end: () => 1322.85 }
    });
    const args = baseArgs({ getMediaEl: () => el, seconds: 1037.93 });

    const { rerender } = renderHook(() => useMediaResilience(args));

    act(() => { el._fire('playing'); });
    advance(1000);

    act(() => { el.paused = true; el._fire('pause'); });
    args.isPaused = true;
    args.pauseIntent = null;
    rerender();
    advance(60_000);

    // NTP drags the wall clock back an hour. vi.setSystemTime moves Date.now()
    // and leaves performance.now() alone, which is exactly the real hazard.
    vi.setSystemTime(Date.now() - 3_600_000);

    act(() => { el.error = { code: 2, message: 'PIPELINE_ERROR_READ' }; el._fire('error'); });
    rerender();

    advance(STALL_JOLT_GRACE_MS + 100);

    expect(args.onReload).not.toHaveBeenCalled();
  });

  it('does not jolt on MEDIA_ERR_SRC_NOT_SUPPORTED — retrying cannot help', () => {
    // Code 4 means the media itself is unplayable: a fresh URL decodes exactly
    // as badly as the stale one, and every rung spent on it is a rung — and a
    // ledger attempt — unavailable to a stall that COULD have recovered.
    // usePlaybackHealth's table test pins RECOVERABLE_MEDIA_ERROR_CODES at the
    // hook boundary; this one proves nothing downstream re-widens it, which is
    // where a filter like this usually leaks.
    installLedger();
    const el = makeFakeEl({
      currentTime: 1037.93,
      duration: 1399.11,
      paused: false,
      buffered: { length: 1, start: () => 0, end: () => 1322.85 }
    });
    const args = baseArgs({ getMediaEl: () => el, seconds: 1037.93 });

    const { rerender } = renderHook(() => useMediaResilience(args));

    act(() => { el._fire('playing'); });
    advance(1000);

    // Identical to the incident in every respect EXCEPT the code.
    act(() => { el.error = { code: 4, message: 'DEMUXER_ERROR_COULD_NOT_OPEN' }; el._fire('error'); });
    el.paused = true;
    rerender();

    advance(STALL_JOLT_GRACE_MS + 100);

    expect(args.onReload).not.toHaveBeenCalled();
    expect(args.onExhausted).not.toHaveBeenCalled();
  });

  it('terminates instead of looping when the error never clears', () => {
    // The unbounded-retry guard. A pipeline that stays dead holds
    // `hasMediaError` true forever, so `isStuck` never falls — exactly the shape
    // that would spin the ladder without a bound. Two bounds exist:
    // STALL_JOLT_LADDER has 2 rungs, and the shared ledger caps a session at
    // RECOVERY_MAX_ATTEMPTS (5). The rung count binds first on this path.
    //
    // Deliberately NOT asserted: how many rungs fired. Between a rung's reset
    // and the `playing` that would clear the code, `hasMediaError` is true with
    // `clockAdvancing` false, so escalating to rung 1 is legitimate — identical
    // to `isBuffering`, which also only clears at `playing`. The invariant worth
    // pinning is that it STOPS.
    installLedger();
    const el = makeFakeEl({
      currentTime: 1037.93,
      duration: 1399.11,
      paused: false,
      buffered: { length: 1, start: () => 0, end: () => 1322.85 }
    });
    const args = baseArgs({ getMediaEl: () => el, seconds: 1037.93 });

    const { rerender } = renderHook(() => useMediaResilience(args));

    act(() => { el._fire('playing'); });
    advance(1000);

    // The proxy dies and never comes back: no `playing`, no element swap, so
    // the code stays latched through every rung.
    act(() => { el.error = { code: 2, message: 'PIPELINE_ERROR_READ' }; el._fire('error'); });
    el.paused = true;
    rerender();

    // 12 x (grace + 1s) = 126s of fake time. The ladder needs
    // GRACE(9.5s) + STEP(6s) + STEP(6s) = 21.5s to fire both rungs and then find
    // no third plan; the ledger's cooldown after attempt 1 is 4s, under the 6s
    // step, so it never delays a rung here. The margin is deliberate — this test
    // is about termination, not about the exact schedule.
    for (let i = 0; i < 12; i += 1) { advance(STALL_JOLT_GRACE_MS + 1000); rerender(); }

    expect(args.onExhausted).toHaveBeenCalled();
    expect(args.onExhausted.mock.calls[0][0]).toMatchObject({ reason: 'stall-jolt-exhausted' });

    // ...and having declared exhaustion it stays stopped. A ladder that reset
    // itself and climbed again would satisfy the assertion above and still be
    // the unbounded-retry bug, so freeze the counts and let more time pass.
    const reloadsAtExhaustion = args.onReload.mock.calls.length;
    const exhaustsAtExhaustion = args.onExhausted.mock.calls.length;
    for (let i = 0; i < 12; i += 1) { advance(STALL_JOLT_GRACE_MS + 1000); rerender(); }

    expect(args.onReload.mock.calls.length).toBe(reloadsAtExhaustion);
    expect(args.onExhausted.mock.calls.length).toBe(exhaustsAtExhaustion);
  });
});
