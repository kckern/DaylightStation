import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

/**
 * Per-rider challenge hold bar: the slim line under a rider's zone progress
 * bar that fills while they stay in the challenge zone for the configured hold
 * (`holdProgressByUser[userId]` from GovernanceEngine.evaluateChallengeZone).
 *
 * The engine only re-evaluates on zone changes, governance ticks and the
 * hold-completion pulse — a handful of times across a 10s hold — so stepping
 * the fill from each snapshot looked like a few frames per second. Instead the
 * fill runs ONE linear CSS animation (transform: scaleX, compositor only) from
 * the hold's start to its end, positioned with a negative animation-delay, and
 * is re-keyed only when the engine's numbers disagree with the running
 * animation (hold reset, pause/resume, total changed).
 */

// A new snapshot whose implied start differs from the running animation by
// less than this is the same hold seen late (evaluation→render lag), not a reset.
export const HOLD_RESYNC_TOLERANCE_MS = 500;

export const HOLD_LABELS = {
  counting: (seconds) => `Hold ${seconds}s`,
  out: 'Keep going',
};

const validHold = (hold) => Boolean(hold && Number.isFinite(hold.totalMs) && hold.totalMs > 0);

/**
 * Pure: which state the bar is in and what it says.
 * @returns {{ phase: 'none'|'counting'|'paused'|'out'|'done', fraction: number,
 *   remainingMs: number, totalMs: number, label: string|null }}
 */
export function resolveHoldBar(hold, { paused = false, belowTarget = false, seenHold = false } = {}) {
  if (!validHold(hold)) {
    // The engine dropped the hold (rider fell out of the zone past any dip
    // grace): keep the empty track and say why, instead of the bar vanishing.
    if (seenHold) return { phase: 'out', fraction: 0, remainingMs: 0, totalMs: 0, label: HOLD_LABELS.out };
    return { phase: 'none', fraction: 0, remainingMs: 0, totalMs: 0, label: null };
  }
  const totalMs = hold.totalMs;
  const elapsedMs = Math.max(0, Math.min(totalMs, Number(hold.elapsedMs) || 0));
  const remainingMs = totalMs - elapsedMs;
  const fraction = elapsedMs / totalMs;
  if (remainingMs <= 0) return { phase: 'done', fraction: 1, remainingMs: 0, totalMs, label: null };
  // Within the engine's dip grace the hold keeps counting, but the rider is
  // already below the zone — tell them before it resets.
  if (belowTarget) return { phase: paused ? 'paused' : 'counting', fraction, remainingMs, totalMs, label: HOLD_LABELS.out };
  return {
    phase: paused ? 'paused' : 'counting',
    fraction, remainingMs, totalMs,
    label: HOLD_LABELS.counting(Math.ceil(remainingMs / 1000)),
  };
}

/** True when the rider's live zone is below the row's target zone. */
export function isBelowTarget(row) {
  const seq = Array.isArray(row?.zoneSequence) ? row.zoneSequence : [];
  const target = row?.targetZone?.id;
  if (!target || !seq.length) return false;
  const targetIndex = seq.findIndex((z) => z.id === target);
  const currentIndex = seq.findIndex((z) => z.id === row?.currentZone?.id);
  if (targetIndex < 0) return false;
  return currentIndex < targetIndex;
}

export default function HoldProgress({ row, now = Date.now }) {
  const hold = validHold(row.holdProgress) ? row.holdProgress : null;
  const paused = Boolean(row.holdPaused);
  const seenRef = useRef(false);
  if (hold) seenRef.current = true;

  // Animation anchor: the wall-clock instant the hold started, as implied by
  // the latest snapshot. Re-derived only when the snapshot's numbers change.
  const syncRef = useRef(null);
  const t = now();
  if (hold) {
    const elapsed = Math.max(0, Math.min(hold.totalMs, Number(hold.elapsedMs) || 0));
    const prev = syncRef.current;
    const sameSnapshot = prev && prev.receivedElapsed === elapsed && prev.totalMs === hold.totalMs && prev.paused === paused;
    if (!sameSnapshot) {
      const anchor = t - elapsed;
      const drift = prev ? Math.abs(anchor - prev.anchor) : Infinity;
      const resync = !prev || prev.totalMs !== hold.totalMs || prev.paused !== paused
        || paused || drift > HOLD_RESYNC_TOLERANCE_MS;
      syncRef.current = {
        anchor: resync ? anchor : prev.anchor,
        receivedElapsed: elapsed,
        totalMs: hold.totalMs,
        paused,
        frozenElapsed: elapsed,
        key: resync ? (prev?.key ?? 0) + 1 : prev.key,
      };
    }
  } else {
    syncRef.current = null;
  }
  const sync = syncRef.current;

  // Live elapsed for the label: from the running anchor while counting, the
  // frozen engine value while paused.
  const liveHold = sync
    ? { totalMs: sync.totalMs,
      elapsedMs: sync.paused ? sync.frozenElapsed : Math.min(sync.totalMs, Math.max(0, t - sync.anchor)) }
    : null;
  const state = resolveHoldBar(liveHold, { paused, belowTarget: isBelowTarget(row), seenHold: seenRef.current });

  // Whole-second label tick while counting — text only, never the bar.
  const [, setTick] = useState(0);
  const counting = state.phase === 'counting';
  const remainingMs = state.remainingMs;
  useEffect(() => {
    if (!counting || remainingMs <= 0) return undefined;
    const untilNextSecond = (remainingMs % 1000) || 1000;
    const id = setTimeout(() => setTick((n) => n + 1), untilNextSecond + 16);
    return () => clearTimeout(id);
  });

  if (state.phase === 'none') return null;

  const name = row.displayName || row.name || row.userId;
  const fillStyle = { background: row.targetZone?.color || undefined };
  let fillClass = 'governance-hold-progress__fill';
  if (state.phase === 'counting' && sync) {
    // One animation over the whole hold, entered part-way via negative delay.
    fillClass += ' governance-hold-progress__fill--running';
    fillStyle.animationDuration = `${sync.totalMs}ms`;
    fillStyle.animationDelay = `${-Math.round(t - sync.anchor)}ms`;
  } else {
    fillStyle.transform = `scaleX(${state.fraction})`;
  }

  const elapsedForAria = Math.round(state.fraction * (state.totalMs || 0));
  return (
    <div className={`governance-hold governance-hold--${state.phase}`} data-phase={state.phase}>
      <div className="governance-hold-progress" role="progressbar"
        aria-label={`${name} zone hold`}
        aria-valuemin={0} aria-valuemax={state.totalMs || 0} aria-valuenow={elapsedForAria}
        aria-valuetext={state.phase === 'out' ? state.label : `${Math.ceil(state.remainingMs / 1000)} seconds remaining`}>
        <span key={sync?.key ?? 'idle'} className={fillClass} style={fillStyle} />
      </div>
      <span className="governance-hold__label" aria-hidden="true">{state.label || ''}</span>
    </div>
  );
}

HoldProgress.propTypes = {
  row: PropTypes.object.isRequired,
  now: PropTypes.func,
};
