/**
 * The coin ceremony's state, for the status board: feed it every NETWORK
 * read of the week's earnings (`observe`), never the board-cache seed, and
 * render `toast` with `CoinCeremony` (keyed on `toast.id`). The first network
 * read per learner since the PAGE loaded is a baseline: the baseline lives at
 * module scope, not in the component, because the board unmounts whenever a
 * code, runner, section or bank screen is open, and the coins a child earns
 * there must still pop when the board comes back. Only a reload clears it
 * (and a change of week still never pops). Rules live in `coinCeremonyModel.js`; this
 * hook owns the timers, the roster lookup and the sound (once per pop).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { schoolLog } from "../schoolLog.js";
import {
  normalizeCoinCeremonyConfig, observeEarnings, emptyQueue, enqueueRise, promote, finish, nextPromoteIn,
} from "./coinCeremonyModel.js";
import { playCoinCue, installCoinCueUnlock } from "./coinCeremonyAudio.js";

// Per-learner baseline ({ silver, from, to }), shared by every mount of the
// board for the life of the page.
let baseline = {};

export function useCoinCeremony({ kids = [], config = null } = {}) {
  const cfg = useMemo(() => normalizeCoinCeremonyConfig(config), [config]);
  const rosterKey = kids.map((k) => k.id).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rosterIds = useMemo(() => new Set(kids.map((k) => k.id)), [rosterKey]);
  const [queue, setQueue] = useState(emptyQueue);

  const observe = useCallback((byLearner) => {
    // Always advance the baseline, even when disabled, so turning the
    // ceremony on later never replays an old rise.
    const { seen, rises } = observeEarnings(baseline, byLearner, rosterIds);
    baseline = seen;
    if (!cfg.enabled || !rises.length) return;
    const now = Date.now();
    for (const r of rises) schoolLog.selfService('status-board.coin-rise', { learnerId: r.learnerId, gained: r.gained, total: r.total });
    setQueue((q) => rises.reduce((acc, r) => enqueueRise(acc, r, now), q));
  }, [cfg.enabled, rosterIds]);

  // The head of the line goes on screen once the burst window has passed.
  useEffect(() => {
    const wait = nextPromoteIn(queue, Date.now(), cfg.coalesceWindowMs);
    if (wait == null) return undefined;
    const timer = setTimeout(() => setQueue((q) => promote(q, Date.now(), cfg.coalesceWindowMs)), wait);
    return () => clearTimeout(timer);
  }, [queue, cfg.coalesceWindowMs]);

  // A pop for someone no longer on the roster is dropped, not stuck.
  const showing = queue.showing;
  const kid = showing ? kids.find((k) => k.id === showing.learnerId) ?? null : null;
  useEffect(() => {
    if (showing && !kid) {
      schoolLog.selfService('status-board.coin-ceremony.dropped', { learnerId: showing.learnerId, reason: 'off-roster' });
      setQueue((q) => finish(q, showing.id));
    }
  }, [showing, kid]);

  // The coin sound: once per pop, keyed on its id (a merged rise bumps the
  // revision and does not replay it).
  const showingId = showing && kid ? showing.id : null;
  const playedRef = useRef(null);
  useEffect(() => {
    if (showingId == null || playedRef.current === showingId) return;
    playedRef.current = showingId;
    if (cfg.sound) playCoinCue({ sound: cfg.sound, volume: cfg.volume });
  }, [showingId, cfg.sound, cfg.volume]);

  // Prime the cue from the first gesture, with the configured sound.
  useEffect(() => {
    if (!cfg.enabled || !cfg.sound) return undefined;
    return installCoinCueUnlock(typeof window !== 'undefined' ? window : null, { sound: cfg.sound });
  }, [cfg.enabled, cfg.sound]);

  // `finish` ignores an id that is not the pop on screen, so a tap during the
  // exit window (or a late timer) never advances the queue twice.
  const done = useCallback((id) => setQueue((q) => finish(q, id)), []);
  return {
    observe,
    toast: showing && kid ? { ...showing, kid } : null,
    done,
    durationMs: cfg.durationMs,
  };
}

export default useCoinCeremony;

export function __resetCoinBaselineForTest() { baseline = {}; }
