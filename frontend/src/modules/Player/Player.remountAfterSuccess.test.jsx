/**
 * A backoff-scheduled remount must be cancelled when playback succeeds before
 * it fires. 2026-09-01: attempt 3 armed at +0ms, playback.started at +20ms,
 * the timer fired at +1500ms and restarted a playing track from 0.
 *
 * Two independent brakes are covered here: the resilience hook reporting
 * `playing` cancels the pending timer outright, and — if no status arrives —
 * the timer's own fire-time guard (scheduledRemountGuard.js) declines to tear down an
 * element whose playhead has moved.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mounts = [];
// The stub stands in for the renderer, so it is also where the test reaches
// Player's metrics plumbing: `onPlaybackMetrics` is what a real renderer calls
// to report the playhead.
const singlePlayer = { onPlaybackMetrics: null };
vi.mock('./components/SinglePlayer.jsx', async () => {
  const { useEffect } = await import('react');
  return {
    SinglePlayer: ({ plexClientSession, onPlaybackMetrics }) => {
      singlePlayer.onPlaybackMetrics = onPlaybackMetrics;
      useEffect(() => { mounts.push(plexClientSession); }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return <div data-testid="single-player-stub" />;
    },
  };
});
vi.mock('../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.reject(new Error('offline in test'))),
}));
vi.mock('./lib/playbackLogger.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, playbackLog: vi.fn() };
});

// Capture the callbacks Player hands the resilience hook so the test can play
// the hook's part: "reload please" and "status changed".
const resilience = { onReload: null, onStateChange: null };
vi.mock('./hooks/useMediaResilience.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useMediaResilience: (opts) => {
      resilience.onReload = opts.onReload;
      resilience.onStateChange = opts.onStateChange;
      return { overlayProps: {}, cancelDeadline: () => {}, requestRecovery: () => {} };
    },
  };
});

import Player from './Player.jsx';
import { playbackLog } from './lib/playbackLogger.js';
import { stallJoltPlan } from './lib/stallJolt.js';

const remountLogs = () => playbackLog.mock.calls.filter(([event]) => event === 'player-remount');
const skippedLogs = () => playbackLog.mock.calls.filter(([event]) => event === 'player-remount-skipped');
const cancelledLogs = () => playbackLog.mock.calls.filter(([event]) => event === 'player-remount-cancelled');

beforeEach(() => {
  mounts.length = 0;
  singlePlayer.onPlaybackMetrics = null;
  resilience.onReload = null;
  resilience.onStateChange = null;
  playbackLog.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Player scheduled remount vs. playback success', () => {
  it('cancels a backoff-scheduled remount when the resilience hook reports playing', async () => {
    render(<Player play={{ contentId: 'plex:620561' }} />);
    await waitFor(() => expect(typeof resilience.onReload).toBe('function'));
    const mountsBefore = mounts.length;

    // Attempt 1: immediate remount (backoff 0).
    act(() => { resilience.onReload({ reason: 'startup-deadline-exceeded' }); });
    await waitFor(() => expect(remountLogs().length).toBe(1));

    // Attempt 2: scheduled with a 1000ms backoff.
    act(() => { resilience.onReload({ reason: 'startup-deadline-exceeded' }); });
    expect(playbackLog.mock.calls.some(([e, d]) => e === 'player-remount-scheduled' && d?.backoffMs > 0)).toBe(true);

    // Playback recovers before the timer fires.
    act(() => { resilience.onStateChange({ status: 'playing' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    expect(remountLogs().length).toBe(1);                 // attempt 2 never fired
    expect(mounts.length).toBe(mountsBefore + 1);         // exactly one real remount
    expect(cancelledLogs().length).toBe(1);               // and it was dropped, not merely late
    expect(skippedLogs().length).toBe(0);                 // by THIS layer, not the fire-time guard
    // Joinable back to the player-remount-scheduled line it cancelled.
    expect(cancelledLogs()[0][1]).toMatchObject({ reason: 'playback-resumed', attempt: 2 });
    expect(cancelledLogs()[0][1].backoffMs).toBeGreaterThan(0);
  });

  it('skips at fire time if the playhead moved even without a status change', async () => {
    render(<Player play={{ contentId: 'plex:620561' }} />);
    await waitFor(() => expect(typeof resilience.onReload).toBe('function'));
    await waitFor(() => expect(typeof singlePlayer.onPlaybackMetrics).toBe('function'));

    // Attempt 1: immediate remount (backoff 0), which resets metrics to 0s.
    act(() => { resilience.onReload({ reason: 'startup-deadline-exceeded' }); });
    await waitFor(() => expect(remountLogs().length).toBe(1));
    const mountsAfterFirst = mounts.length;

    // Attempt 2: armed at 0s with a 1000ms backoff.
    act(() => { resilience.onReload({ reason: 'startup-deadline-exceeded' }); });

    // The stream releases: the playhead advances, and no stall is reported.
    // Nothing tells the Player its status changed — only the numbers move.
    act(() => { singlePlayer.onPlaybackMetrics({ seconds: 1.2, stalled: false }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    expect(remountLogs().length).toBe(1);
    expect(mounts.length).toBe(mountsAfterFirst);
    expect(skippedLogs().length).toBe(1);
    expect(cancelledLogs().length).toBe(0);               // by THIS layer, not cancel-on-status
    expect(skippedLogs()[0][1]).toMatchObject({
      reason: 'playback-resumed',
      attempt: 2,
      armedAtSeconds: 0,
      playbackSeconds: 1.2,
      advancedSeconds: 1.2
    });
    expect(skippedLogs()[0][1].backoffMs).toBeGreaterThan(0);
  });

  // A wedged forward seek is the one stall class that moves the clock: assigning
  // currentTime jumps it instantly while el.seeking stays stuck true and no data
  // arrives. If the guard read that as progress it would skip the remount that
  // unwedges it — this fix would then CAUSE a stall.
  it('still remounts when the clock jumped but a seek is stuck in flight', async () => {
    render(<Player play={{ contentId: 'plex:620561' }} />);
    await waitFor(() => expect(typeof resilience.onReload).toBe('function'));
    await waitFor(() => expect(typeof singlePlayer.onPlaybackMetrics).toBe('function'));

    act(() => { resilience.onReload({ reason: 'startup-deadline-exceeded' }); });
    await waitFor(() => expect(remountLogs().length).toBe(1));
    const mountsAfterFirst = mounts.length;

    act(() => { resilience.onReload({ reason: 'startup-deadline-exceeded' }); });
    act(() => { singlePlayer.onPlaybackMetrics({ seconds: 600, stalled: false, isSeeking: true }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    expect(skippedLogs().length).toBe(0);
    expect(remountLogs().length).toBe(2);
    expect(mounts.length).toBe(mountsAfterFirst + 1);
  });

  // The viewer pressed retry after recovery exhausted. Both brakes are "playback
  // looks fine now" heuristics; neither may discard an explicit request, and the
  // exhaustion nonce makes the backoff window they act inside a long one.
  it('never discards a user-initiated retry, even with playback apparently healthy', async () => {
    render(<Player play={{ contentId: 'plex:620561' }} />);
    await waitFor(() => expect(typeof resilience.onReload).toBe('function'));
    await waitFor(() => expect(typeof singlePlayer.onPlaybackMetrics).toBe('function'));

    act(() => { resilience.onReload({ reason: 'startup-deadline-exceeded' }); });
    await waitFor(() => expect(remountLogs().length).toBe(1));
    const mountsAfterFirst = mounts.length;

    // Exactly what the hook's retry-from-exhausted path sends
    // (useMediaResilience.js:326). `userInitiated` is the consent signal; the
    // `forceRemount` alongside it is only about mechanism, and the stall-jolt
    // test above pins that the two are not interchangeable.
    act(() => {
      resilience.onReload({
        reason: 'user-retry-exhausted',
        refreshUrl: true,
        forceRemount: true,
        userInitiated: true,
        seekToIntentMs: 90000
      });
    });

    // Everything that would normally cancel or skip, at once.
    act(() => { singlePlayer.onPlaybackMetrics({ seconds: 5, stalled: false, isSeeking: false }); });
    act(() => { resilience.onStateChange({ status: 'playing' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });

    expect(cancelledLogs().length).toBe(0);
    expect(skippedLogs().length).toBe(0);
    expect(remountLogs().length).toBe(2);
    expect(mounts.length).toBe(mountsAfterFirst + 1);
    // The position the user picked survives the remount.
    expect(remountLogs()[1][1]).toMatchObject({ reason: 'user-retry-exhausted', seekSeconds: 90 });
  });

  // `forceRemount` is NOT a proxy for "a human asked". The stall-jolt ladder's
  // second rung sets it automatically ~9.5s into a mid-playback stall — which is
  // exactly where a stream releases mid-backoff, i.e. the September 1 incident.
  // Only the hook's retry-from-exhausted path speaks for a viewer.
  it('cancels for the stall-jolt ladder, which sets forceRemount with no human involved', async () => {
    const rung = stallJoltPlan(1);
    expect(rung.forceRemount).toBe(true);   // the trap: same flag, automatic source

    render(<Player play={{ contentId: 'plex:620561' }} />);
    await waitFor(() => expect(typeof resilience.onReload).toBe('function'));

    act(() => { resilience.onReload({ reason: 'startup-deadline-exceeded' }); });
    await waitFor(() => expect(remountLogs().length).toBe(1));
    const mountsAfterFirst = mounts.length;

    // Exactly what useMediaResilience.js:711 sends for this rung.
    act(() => {
      resilience.onReload({
        reason: rung.reason,
        refreshUrl: rung.refreshUrl,
        forceRemount: rung.forceRemount,
        seekToIntentMs: 5000
      });
    });
    const scheduled = playbackLog.mock.calls.filter(([e]) => e === 'player-remount-scheduled');
    expect(scheduled[scheduled.length - 1][1].userInitiated).toBe(false);

    // The stream releases and playback recovers before the timer fires.
    act(() => { resilience.onStateChange({ status: 'playing' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });

    expect(cancelledLogs().length).toBe(1);
    expect(remountLogs().length).toBe(1);
    expect(mounts.length).toBe(mountsAfterFirst);
  });

  // The cancel branch runs AHEAD of the delegation to the caller's handler. A
  // stray early return there would silently stop the host app hearing about
  // playback, with nothing else failing.
  it('delegates every state to the caller, including the one that cancels', async () => {
    const onStateChange = vi.fn();
    render(<Player play={{ contentId: 'plex:620561' }} resilience={{ onStateChange }} />);
    await waitFor(() => expect(typeof resilience.onReload).toBe('function'));

    act(() => { resilience.onReload({ reason: 'startup-deadline-exceeded' }); });
    await waitFor(() => expect(remountLogs().length).toBe(1));
    act(() => { resilience.onReload({ reason: 'startup-deadline-exceeded' }); });

    onStateChange.mockClear();
    act(() => { resilience.onStateChange({ status: 'stalling' }); });
    act(() => { resilience.onStateChange({ status: 'playing' }); });   // cancels the pending timer
    act(() => { resilience.onStateChange({ status: 'paused' }); });

    expect(cancelledLogs().length).toBe(1);
    expect(onStateChange.mock.calls.map(([state]) => state.status))
      .toEqual(['stalling', 'playing', 'paused']);
  });
});
