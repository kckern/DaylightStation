import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import getLogger from '@/lib/logging/Logger.js';
import { playCueOnce } from '@/modules/Fitness/player/hooks/useGovernanceAudioDuck.js';
import './RestTimer.scss';

/**
 * The rest step of a guided workout: a big glanceable countdown that
 * auto-advances when it hits zero.
 *
 * WHY A DEADLINE, NOT A COUNTER
 * -----------------------------
 * A `setInterval(1000)` that decrements a number drifts, and the garage kiosk
 * runs for weeks — a background/throttled tab can swallow ticks entirely, so a
 * 90 s rest would finish late by however much the browser stole. This ticks
 * four times a second but derives the number from a wall-clock deadline set
 * once at mount, so a missed tick costs nothing and rest ends when rest is
 * actually over.
 *
 * AUDIO — read audioCuePlayer.js before touching this
 * ---------------------------------------------------
 * The garage Firefox kiosk ships `media.autoplay.default=1`: audible playback
 * is blocked until the page has a user gesture, and a freshly constructed
 * `Audio` has never had one. So this constructs NOTHING — every cue goes
 * through `playCueOnce`, which plays on the single shared element that
 * `installCueAudioUnlock` (armed by WorkoutRunner) primes on the first tap.
 * Browse and Build both start with taps, so by the time a rest step exists the
 * element is unlocked. Cues are fire-and-forget: a rejected play is logged by
 * the cue player and never blocks the countdown.
 *
 * The component owns the clock and the cues only. The Done/Skip target lives in
 * WorkoutRunner, which owns step ordering — so "skip this rest" and "the rest
 * elapsed" are one code path there instead of two that can disagree.
 */

// Tick faster than the number changes so the displayed second flips promptly
// after a throttled gap, without a per-frame render.
const TICK_MS = 250;

// How many seconds out the beeps start. Three is the stoplight convention the
// cycle game already uses, and it is enough warning to get back to the bar.
const CUE_FROM_SECONDS = 3;

const DEFAULT_TICK_SOUND = 'apps/fitness/ux/cycle-game-countdown.wav';
const DEFAULT_GO_SOUND = 'apps/fitness/ux/cycle-game-go.wav';

export default function RestTimer({
  seconds,
  nextLabel = null,
  afterLabel = null,
  onDone = null,
  tickSound = DEFAULT_TICK_SOUND,
  goSound = DEFAULT_GO_SOUND
}) {
  const logger = useMemo(() => getLogger().child({ component: 'rest-timer' }), []);

  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const [remaining, setRemaining] = useState(total);

  // Callbacks and cue paths live in refs so the countdown effect depends only on
  // `total` — a parent that re-renders with a fresh arrow must not restart rest.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const soundsRef = useRef({ tickSound, goSound });
  soundsRef.current = { tickSound, goSound };

  // Latched once the countdown has ended, so the elapsed path can never fire
  // twice and the unmount path can tell "skipped" from "finished".
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    setRemaining(total);
    logger.info('rest-start', { seconds: total, after: afterLabel, next: nextLabel });

    const finish = (reason) => {
      if (doneRef.current) return;
      doneRef.current = true;
      logger.info('rest-end', { reason, seconds: total });
      if (soundsRef.current.goSound) playCueOnce({ sound: soundsRef.current.goSound });
      onDoneRef.current?.(reason);
    };

    // A zero/absent rest is not something expandWorkout emits (it only writes a
    // rest step when restSeconds > 0), but if one ever arrives, pass straight
    // through rather than parking the screen on "0".
    if (total <= 0) {
      finish('elapsed');
      return undefined;
    }

    const deadline = Date.now() + total * 1000;
    let announced = total;
    let timer = null;

    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left < announced) {
        announced = left;
        if (left > 0 && left <= CUE_FROM_SECONDS && soundsRef.current.tickSound) {
          playCueOnce({ sound: soundsRef.current.tickSound });
        }
      }
      if (left <= 0) {
        if (timer !== null) clearInterval(timer);
        timer = null;
        finish('elapsed');
      }
    };

    timer = setInterval(tick, TICK_MS);

    // Cleanup runs on unmount AND on a `total` change. Clearing the interval
    // here is the whole reason a kiosk can hold this screen for weeks without
    // accumulating orphaned clocks that setState into unmounted trees.
    return () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
      if (!doneRef.current) {
        doneRef.current = true;
        logger.info('rest-end', { reason: 'interrupted', seconds: total });
      }
    };
    // `logger` is useMemo-stable; the labels are display-only and deliberately
    // excluded so relabeling never restarts the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, logger]);

  const urgent = remaining > 0 && remaining <= CUE_FROM_SECONDS;

  return (
    <div
      className={`rest-timer${urgent ? ' is-urgent' : ''}`}
      data-testid="rest-timer"
      data-remaining={remaining}
      role="timer"
      aria-live="off"
    >
      <div className="rest-timer__eyebrow">Rest</div>

      {/* key on the value re-triggers the punch-in animation each second */}
      <div className="rest-timer__count" data-testid="rest-timer-count" key={remaining}>
        {remaining}
      </div>

      <div className="rest-timer__unit">seconds</div>

      {afterLabel && (
        <div className="rest-timer__after" data-testid="rest-timer-after">
          after {afterLabel}
        </div>
      )}

      {nextLabel && (
        <div className="rest-timer__next" data-testid="rest-timer-next">
          <span className="rest-timer__next-label">Next up</span>
          <span className="rest-timer__next-name">{nextLabel}</span>
        </div>
      )}
    </div>
  );
}

RestTimer.propTypes = {
  seconds: PropTypes.number.isRequired,
  nextLabel: PropTypes.string,
  afterLabel: PropTypes.string,
  onDone: PropTypes.func,
  tickSound: PropTypes.string,
  goSound: PropTypes.string
};
