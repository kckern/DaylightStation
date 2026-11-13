import { useCallback, useEffect, useRef, useState } from 'react';
import { GESTURES } from '../../lib/skylineInvaders/gestures.js';
import { advanceTryout, createTryout, tryoutSummary, tryoutTargets } from '../../lib/skylineInvaders/tryout.js';
import { INVADERS_TUNABLES } from '../../lib/skylineInvaders/tunables.js';

// The controls intro's moving parts, with no markup: which card is up, the
// tryout on it, and the card clock. The shell draws it as one of its menu
// screens (InvadersMenus `controls`) and turns presses into `go`, `choose`
// and `close`.
//
// While it is active the game's aim tracker plays the card's gesture, so the
// real cannon follows the defender, and three practice targets (left edge,
// middle, right edge) light when the cannon is under them. The targets are the
// same for every gesture, so the time to reach each one compares the gestures
// directly. A card moves on by itself after `tryoutCardS`.

const POLL_MS = 50;

/**
 * @param {object} options
 * @param {boolean} options.active          the controls screen is up
 * @param {object} options.tracker          the game's aim tracker
 * @param {string|null} options.current     the gesture the defender already has: the card it opens on
 * @param {function} [options.onTryout]     (summary) one card's tryout ended (tryout.js tryoutSummary)
 * @param {function} [options.onCard]       (gesture, index) a card opened
 * @param {function} [options.onTick]       ({ at, lane, tryout }) every poll, for the trace recorder
 * @returns {{ gesture, index, lane, lost, reached, leftS, leftPct, targets, go, choose, close }}
 */
export default function useInvadersTryout({ active = false, tracker, current = null, onTryout, onCard, onTick, tunables = INVADERS_TUNABLES } = {}) {
  const [index, setIndex] = useState(0);
  const [view, setView] = useState(() => ({ tryout: createTryout(GESTURES[0], 0), lane: tracker.sample().lane, lost: true, leftS: tunables.tryoutCardS }));
  const tryoutRef = useRef(view.tryout);
  const live = useRef({});
  live.current = { index, onTryout, onCard, onTick, active };
  const gesture = GESTURES[index];

  // Open on the card the defender already uses.
  const wasActive = useRef(false);
  useEffect(() => {
    if (active && !wasActive.current) setIndex(Math.max(0, GESTURES.indexOf(current)));
    wasActive.current = active;
  }, [active, current]);

  // Close out the card in hand, with how it ended.
  const finish = useCallback((how) => {
    if (live.current.active) live.current.onTryout?.(tryoutSummary(tryoutRef.current, Date.now(), how));
  }, []);
  const go = useCallback((delta, how) => {
    finish(how);
    setIndex((at) => (at + delta + GESTURES.length) % GESTURES.length);
  }, [finish]);
  /** The defender picked the card in hand: returns its gesture. */
  const choose = useCallback((how) => {
    finish(`chosen-${how}`);
    return GESTURES[live.current.index];
  }, [finish]);
  const close = useCallback(() => finish('closed'), [finish]);

  // A card opens: the tracker takes its gesture and the tryout starts over.
  useEffect(() => {
    if (!active) return undefined;
    tracker.setGesture(gesture);
    const opened = Date.now();
    tryoutRef.current = createTryout(gesture, opened);
    setView({ tryout: tryoutRef.current, lane: tracker.sample().lane, lost: tracker.sample().lost, leftS: tunables.tryoutCardS });
    live.current.onCard?.(gesture, index);
    let timedOut = false;
    const timer = setInterval(() => {
      if (timedOut) return;
      const at = Date.now();
      const sample = tracker.sample();
      const next = advanceTryout(tryoutRef.current, sample.lane, at, { holdMs: tunables.tryoutTargetHoldMs });
      tryoutRef.current = next;
      live.current.onTick?.({ at, lane: sample.lane, tryout: next });
      const leftS = Math.max(0, Math.ceil(tunables.tryoutCardS - (at - opened) / 1000));
      setView((prior) => (prior.lane === sample.lane && prior.lost === sample.lost && prior.leftS === leftS && prior.tryout.on === next.on && prior.tryout.reached === next.reached
        ? prior : { tryout: next, lane: sample.lane, lost: sample.lost, leftS }));
      if (at - opened >= tunables.tryoutCardS * 1000) { timedOut = true; go(1, 'timeout'); }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, gesture, index, tracker, tunables, go]);

  return {
    gesture, index, lane: view.lane, lost: view.lost,
    reached: Object.keys(view.tryout.reached).length,
    leftS: view.leftS, leftPct: (100 * view.leftS) / tunables.tryoutCardS,
    targets: tryoutTargets(view.tryout),
    go, choose, close,
  };
}
