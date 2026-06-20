import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import {
  getCycleOverlayVisuals,
  polarToCartesian,
  rpmToAngle
} from './cycleOverlayVisuals.js';
import { CycleBaseReqIndicator } from './CycleBaseReqIndicator.jsx';
import CompletionCountBlocks from './CompletionCountBlocks.jsx';
import CycleHealthBar from './CycleHealthBar.jsx';
import getLogger from '@/lib/logging/Logger.js';
import './CycleChallengeOverlay.scss';

/**
 * CycleChallengeOverlay (Tasks 21 + 22 + 23, 2026-05-03 redesign).
 *
 * Circular ~220px widget that visualises the active cycle challenge:
 *   - Outer status ring track (faint full-circle outline)
 *   - Lower-hemisphere phase progress arc (9 → 6 → 3 o'clock). Monotonic phase
 *     progress fill; color/opacity driven by cycleState/dimFactor only.
 *   - RPM gauge arc (top hemisphere) with tick marks, hi/lo markers, needle (Task 22)
 *   - Target RPM sign anchored to the hi-rpm tick on the gauge arc (Task 22)
 *   - Rider avatar centered (sole rider identifier; heart-rate gate dot pinned to it)
 *   - Health meter bar (depletes below loRpm; empty meter = video paused)
 *   - Phase count blocks (rounded squares — one per phase, completed phases lit)
 *   - Boost multiplier badge (×2.5) shown below the widget when >1.0
 *
 * During a health-lock (cycleState='locked', lockReason='health') the overlay
 * stays mounted with the empty health meter so the rider knows to pedal back
 * into the green zone to resume playback.
 *
 * Position (top / middle / bottom) is owned by ChallengeOverlayDeck — this
 * component renders inside the deck and does not manage its own placement.
 */

const CYCLE_VIEWBOX_SIZE = 220;
const CYCLE_RING_RADIUS = 100;
const CYCLE_RING_CENTER = CYCLE_VIEWBOX_SIZE / 2;
const CYCLE_RING_STROKE_WIDTH = 8;

// RPM gauge geometry — top hemisphere inside the outer ring.
const CYCLE_GAUGE_RADIUS = 80;
const CYCLE_GAUGE_MAX_RPM = 120;
const CYCLE_GAUGE_TICK_STEP = 10;
const CYCLE_GAUGE_TICK_INNER_OFFSET = 4; // inward from arc
const CYCLE_GAUGE_TICK_OUTER_OFFSET = 2; // outward from arc
const CYCLE_GAUGE_HILO_INNER_OFFSET = 6;
const CYCLE_GAUGE_HILO_OUTER_OFFSET = 6;
const CYCLE_GAUGE_TARGET_OFFSET = 18; // px outward from arc for the target label anchor

// Completion-hold ring color (§5A) — matches the HR overlay's SUCCESS_RING_COLOR.
const CYCLE_DONE_RING_COLOR = '#22c55e';

const firstInitial = (value) => {
  if (typeof value !== 'string') return '?';
  const trimmed = value.trim();
  if (!trimmed) return '?';
  const ch = trimmed.charAt(0).toUpperCase();
  return ch || '?';
};

export const CycleChallengeOverlay = ({ challenge, onRequestSwap, done = false }) => {
  const visuals = useMemo(() => getCycleOverlayVisuals(challenge), [challenge]);

  const logger = useMemo(
    () => getLogger().child({ component: 'cycle-challenge-overlay' }),
    []
  );

  useEffect(() => {
    if (!visuals.visible) return;
    logger.debug('mounted', {
      cycleState: challenge?.cycleState,
      phaseIndex: challenge?.currentPhaseIndex,
      totalPhases: challenge?.totalPhases
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visuals.visible]);

  useEffect(() => {
    if (!visuals.visible) return;
    logger.debug('state-change', {
      cycleState: challenge?.cycleState,
      dimFactor: challenge?.dimFactor,
      phaseProgressPct: challenge?.phaseProgressPct
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.cycleState, challenge?.dimFactor, challenge?.phaseProgressPct]);

  const handleAvatarClick = useCallback((event) => {
    event.stopPropagation();
    if (!challenge) return;
    if (challenge.swapAllowed && typeof onRequestSwap === 'function') {
      logger.info('swap-requested', {
        riderId: challenge.rider?.id,
        riderName: challenge.rider?.name,
        phaseIndex: challenge.currentPhaseIndex
      });
      onRequestSwap();
    }
  }, [challenge, onRequestSwap, logger]);

  // --- Hooks that must be ABOVE the early return (Rules of Hooks) ------------
  // challenge may be null here — use ?. throughout.
  const riderId = (typeof challenge?.rider === 'string'
    ? challenge.rider
    : challenge?.rider?.id) || null;
  const riderAvatarUrl = riderId
    ? `/api/v1/static/img/users/${riderId}`
    : '/api/v1/static/img/users/user';

  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [riderAvatarUrl]);

  const {
    hiRpm, gaugeTicks, arcPath,
    hiAngle, loAngle, hiTickInner, hiTickOuter, loTickInner, loTickOuter
  } = useMemo(() => {
    const _hiRpm = Number.isFinite(challenge?.currentPhase?.hiRpm) ? challenge.currentPhase.hiRpm : null;
    const _loRpm = Number.isFinite(challenge?.currentPhase?.loRpm) ? challenge.currentPhase.loRpm : null;

    const ticks = [];
    for (let rpm = 0; rpm <= CYCLE_GAUGE_MAX_RPM; rpm += CYCLE_GAUGE_TICK_STEP) {
      const angle = rpmToAngle(rpm, CYCLE_GAUGE_MAX_RPM);
      ticks.push({
        rpm,
        inner: polarToCartesian(CYCLE_RING_CENTER, CYCLE_RING_CENTER, CYCLE_GAUGE_RADIUS - CYCLE_GAUGE_TICK_INNER_OFFSET, angle),
        outer: polarToCartesian(CYCLE_RING_CENTER, CYCLE_RING_CENTER, CYCLE_GAUGE_RADIUS + CYCLE_GAUGE_TICK_OUTER_OFFSET, angle)
      });
    }

    const aStart = polarToCartesian(CYCLE_RING_CENTER, CYCLE_RING_CENTER, CYCLE_GAUGE_RADIUS, Math.PI);
    const aEnd = polarToCartesian(CYCLE_RING_CENTER, CYCLE_RING_CENTER, CYCLE_GAUGE_RADIUS, 2 * Math.PI);
    const _arcPath = `M ${aStart.x} ${aStart.y} A ${CYCLE_GAUGE_RADIUS} ${CYCLE_GAUGE_RADIUS} 0 0 1 ${aEnd.x} ${aEnd.y}`;

    const _hiAngle = _hiRpm != null ? rpmToAngle(_hiRpm, CYCLE_GAUGE_MAX_RPM) : null;
    const _loAngle = _loRpm != null ? rpmToAngle(_loRpm, CYCLE_GAUGE_MAX_RPM) : null;
    const mk = (angle, offIn, offOut) => angle != null ? {
      inner: polarToCartesian(CYCLE_RING_CENTER, CYCLE_RING_CENTER, CYCLE_GAUGE_RADIUS - offIn, angle),
      outer: polarToCartesian(CYCLE_RING_CENTER, CYCLE_RING_CENTER, CYCLE_GAUGE_RADIUS + offOut, angle)
    } : { inner: null, outer: null };
    const hi = mk(_hiAngle, CYCLE_GAUGE_HILO_INNER_OFFSET, CYCLE_GAUGE_HILO_OUTER_OFFSET);
    const lo = mk(_loAngle, CYCLE_GAUGE_HILO_INNER_OFFSET, CYCLE_GAUGE_HILO_OUTER_OFFSET);

    return {
      hiRpm: _hiRpm, gaugeTicks: ticks, arcPath: _arcPath,
      hiAngle: _hiAngle, loAngle: _loAngle,
      hiTickInner: hi.inner, hiTickOuter: hi.outer, loTickInner: lo.inner, loTickOuter: lo.outer
    };
  }, [challenge?.currentPhase?.hiRpm, challenge?.currentPhase?.loRpm]);

  // On success the overlay holds briefly in a "done" celebration (§5A) even
  // though getCycleOverlayVisuals returns OFF for terminal states — the `done`
  // prop (driven by useCycleSuccessHold) keeps it mounted for the hold window.
  if ((!visuals.visible && !done) || !challenge) {
    return null;
  }

  const {
    ringColor,
    ringOpacity,
    dimPulse,
    phaseProgress,
    lostSignal,
    stale,
    waitingForBaseReq,
    cycleHealthPct
  } = visuals;

  // Done overrides: full green completion ring at full opacity.
  const effRingColor = done ? CYCLE_DONE_RING_COLOR : ringColor;
  const effRingOpacity = done ? 1 : ringOpacity;
  const effPhaseProgress = done ? 1 : phaseProgress;

  const totalPhases = Number.isFinite(challenge.totalPhases)
    ? Math.max(0, challenge.totalPhases)
    : 0;
  const currentPhaseIndex = Number.isFinite(challenge.currentPhaseIndex)
    ? Math.max(0, challenge.currentPhaseIndex)
    : 0;
  const riderName = (typeof challenge.rider === 'string'
    ? challenge.rider
    : (challenge.rider?.name || challenge.rider?.id)) || '';
  const riderInitial = firstInitial(riderName);

  // --- RPM gauge geometry (Task 22) -----------------------------------------
  const currentRpm = Number.isFinite(challenge.currentRpm) ? challenge.currentRpm : 0;

  // Health bar is hidden by default. It only appears when the rider is actually
  // at risk: below the red line (loRpm) during maintain, or held in a health
  // lock (empty pool, video paused). Holding green / init / ramp show nothing.
  const loRpm = Number.isFinite(challenge.currentPhase?.loRpm)
    ? challenge.currentPhase.loRpm
    : null;
  const showHealthBar =
    (challenge.cycleState === 'maintain' && loRpm != null && currentRpm < loRpm)
    || (challenge.cycleState === 'locked' && challenge.lockReason === 'health');

  const needleAngle = rpmToAngle(currentRpm, CYCLE_GAUGE_MAX_RPM);
  const needleDeg = ((needleAngle - 1.5 * Math.PI) * 180) / Math.PI;
  const atHi = hiRpm != null && currentRpm >= hiRpm;
  const targetRpm = hiRpm != null ? Math.round(hiRpm) : null;

  // Target label anchor — sits just outside the hi-rpm tick on the arc.
  // Fallback (no hi) is top-center at the same radial offset.
  const targetAnchorAngle = hiAngle != null ? hiAngle : 1.5 * Math.PI;
  const targetAnchor = polarToCartesian(
    CYCLE_RING_CENTER,
    CYCLE_RING_CENTER,
    CYCLE_GAUGE_RADIUS + CYCLE_GAUGE_TARGET_OFFSET,
    targetAnchorAngle
  );
  // Convert viewBox coords to percentages for CSS positioning.
  const targetLeftPct = (targetAnchor.x / CYCLE_VIEWBOX_SIZE) * 100;
  const targetTopPct = (targetAnchor.y / CYCLE_VIEWBOX_SIZE) * 100;

  // Lower-hemisphere phase progress arc geometry (9 → 6 → 3 o'clock).
  // Fill fraction is always driven by phaseProgress (monotonic within a phase).
  // Color/opacity are state-driven via ringColor/ringOpacity. Danger handling
  // lives entirely on the separate __danger-ring circle rendered below.
  const phaseArcStartPt = polarToCartesian(
    CYCLE_RING_CENTER, CYCLE_RING_CENTER, CYCLE_RING_RADIUS, Math.PI
  );
  const phaseArcEndPt = polarToCartesian(
    CYCLE_RING_CENTER, CYCLE_RING_CENTER, CYCLE_RING_RADIUS, 0
  );
  const phaseArcLen = Math.PI * CYCLE_RING_RADIUS; // half-circumference
  // Phase arc is progress ONLY — monotonic. It holds when paused, and fills
  // completely during the done celebration (effPhaseProgress === 1).
  const phaseArcDashOffset = phaseArcLen * (1 - effPhaseProgress);
  // Sweep flag = 0 with start at 9 o'clock and end at 3 o'clock routes through
  // the bottom (6 o'clock) in SVG y-down coordinates.
  const phaseArcPath =
    `M ${phaseArcStartPt.x} ${phaseArcStartPt.y} ` +
    `A ${CYCLE_RING_RADIUS} ${CYCLE_RING_RADIUS} 0 0 0 ${phaseArcEndPt.x} ${phaseArcEndPt.y}`;

  // --- Boost multiplier badge -----------------------------------------------
  const rawMultiplier = Number.isFinite(challenge.boostMultiplier)
    ? challenge.boostMultiplier
    : 1;
  const showBoostBadge = rawMultiplier > 1;
  const boostText = `×${rawMultiplier.toFixed(1)}`;

  const classNames = ['cycle-challenge-overlay'];
  if (challenge.cycleState) {
    classNames.push(`cycle-challenge-overlay--state-${String(challenge.cycleState).toLowerCase()}`);
  }
  if (dimPulse) {
    classNames.push('cycle-challenge-overlay--dim-pulse');
  }
  if (lostSignal) classNames.push('cycle-challenge-overlay--lost-signal');
  if (stale)      classNames.push('cycle-challenge-overlay--stale');
  if (done)       classNames.push('cycle-challenge-overlay--phase-done');

  const swapAllowed = Boolean(challenge.swapAllowed);

  const ariaLabel = `Cycle challenge — ${challenge.cycleState || 'state unknown'}, phase ${Math.min(totalPhases, currentPhaseIndex + 1)} of ${totalPhases}`;

  return (
    <div
      className={classNames.join(' ')}
      aria-label={ariaLabel}
    >
      <svg
        className="cycle-challenge-overlay__ring"
        viewBox={`0 0 ${CYCLE_VIEWBOX_SIZE} ${CYCLE_VIEWBOX_SIZE}`}
        aria-hidden="true"
      >
        <circle
          className="cycle-challenge-overlay__ring-track"
          cx={CYCLE_RING_CENTER}
          cy={CYCLE_RING_CENTER}
          r={CYCLE_RING_RADIUS}
          fill="none"
          strokeWidth={CYCLE_RING_STROKE_WIDTH}
        />

        {/* --- RPM gauge arc (Task 22) ---------------------------------- */}
        <g className="cycle-challenge-overlay__gauge" aria-hidden="true">
          <path
            className="cycle-challenge-overlay__gauge-arc"
            d={arcPath}
            fill="none"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="2"
          />

          {gaugeTicks.map((tick) => (
            <line
              key={`tick-${tick.rpm}`}
              className="cycle-challenge-overlay__gauge-tick"
              x1={tick.inner.x}
              y1={tick.inner.y}
              x2={tick.outer.x}
              y2={tick.outer.y}
              stroke="rgba(255,255,255,0.35)"
              strokeWidth="1"
            />
          ))}

          {loAngle !== null && (
            <line
              className="cycle-challenge-overlay__gauge-tick-lo"
              x1={loTickInner.x}
              y1={loTickInner.y}
              x2={loTickOuter.x}
              y2={loTickOuter.y}
              stroke="#ef4444"
              strokeWidth="3"
              strokeLinecap="round"
            />
          )}

          {hiAngle !== null && (
            <line
              className="cycle-challenge-overlay__gauge-tick-hi"
              x1={hiTickInner.x}
              y1={hiTickInner.y}
              x2={hiTickOuter.x}
              y2={hiTickOuter.y}
              stroke="#22c55e"
              strokeWidth="3"
              strokeLinecap="round"
            />
          )}

          <g
            className={`cycle-needle-group${atHi ? ' cycle-needle-group--at-hi' : ''}`}
            style={{
              transform: `rotate(${needleDeg}deg)`,
              transformBox: 'view-box',
              transformOrigin: `${CYCLE_RING_CENTER}px ${CYCLE_RING_CENTER}px`,
              transition: 'transform 0.18s ease'
            }}
          >
            <line
              className={`cycle-needle${atHi ? ' cycle-needle--at-hi' : ''}`}
              x1={CYCLE_RING_CENTER}
              y1={CYCLE_RING_CENTER}
              x2={CYCLE_RING_CENTER}
              y2={CYCLE_RING_CENTER - CYCLE_GAUGE_RADIUS}
              stroke={atHi ? '#22c55e' : '#e2e8f0'}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </g>
          <circle
            className="cycle-needle-hub"
            cx={CYCLE_RING_CENTER}
            cy={CYCLE_RING_CENTER}
            r={3}
            fill={atHi ? '#22c55e' : '#e2e8f0'}
          />
        </g>

        {/* Phase progress arc — reflects phaseProgress only (monotonic). */}
        <path
          className="cycle-challenge-overlay__phase-arc"
          d={phaseArcPath}
          fill="none"
          stroke={effRingColor}
          strokeWidth={CYCLE_RING_STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${phaseArcLen}px`}
          strokeDashoffset={`${phaseArcDashOffset}px`}
          style={{ opacity: effRingOpacity }}
        />
      </svg>

      {targetRpm !== null && (
        <div
          className="cycle-challenge-overlay__target"
          aria-label={`Target RPM ${targetRpm}`}
          style={{ left: `${targetLeftPct}%`, top: `${targetTopPct}%` }}
        >
          <span className="cycle-challenge-overlay__target-value">{targetRpm}</span>
        </div>
      )}

      <div className="cycle-challenge-overlay__avatar-wrap">
        <button
          type="button"
          className={`cycle-challenge-overlay__avatar${swapAllowed ? ' is-clickable' : ''}`}
          onClick={handleAvatarClick}
          disabled={!swapAllowed}
          aria-label={`Rider: ${riderName || 'unknown'}${swapAllowed ? ' — tap to swap' : ''}`}
        >
          {!imgFailed && (
            <img
              className="cycle-challenge-overlay__avatar-img"
              src={riderAvatarUrl}
              alt=""
              onError={() => setImgFailed(true)}
            />
          )}
          {imgFailed && (
            <span className="cycle-challenge-overlay__avatar-initials">
              {riderInitial}
            </span>
          )}
        </button>
        {done && (
          <span className="cycle-challenge-overlay__done-check" aria-hidden="true">✓</span>
        )}
        <CycleBaseReqIndicator
          compact
          baseReqSatisfied={Boolean(challenge.baseReqSatisfiedForRider)}
          waitingForBaseReq={waitingForBaseReq}
        />
      </div>

      {/* Lower content as one bottom-anchored flex column — guarantees the
          name, boost badge, phase blocks, and RPM readout stack
          without overlap and stay centered regardless of overlay diameter. */}
      <div className="cycle-challenge-overlay__stack">
        {totalPhases > 0 && (
          <CompletionCountBlocks
            targetCount={totalPhases}
            actualCount={Math.max(0, currentPhaseIndex)}
            activeIndex={Math.max(0, currentPhaseIndex)}
            containerClassName="cycle-challenge-overlay__phase-blocks"
            blockClassName="cycle-challenge-overlay__phase-block"
            completeBlockClassName="cycle-challenge-overlay__phase-block--complete"
            activeBlockClassName="cycle-challenge-overlay__phase-block--active"
            ariaLabel={`Phase ${Math.min(totalPhases, currentPhaseIndex + 1)} of ${totalPhases}`}
          />
        )}

        <div
          className="cycle-challenge-overlay__current-rpm"
          aria-label={`Current RPM ${Math.round(currentRpm)}`}
        >
          <span className="cycle-challenge-overlay__current-rpm-value">{Math.round(currentRpm)}</span>
          <span className="cycle-challenge-overlay__current-rpm-unit">RPM</span>
        </div>
      </div>

      {showHealthBar && <CycleHealthBar pct={cycleHealthPct ?? 1} />}

      {showBoostBadge && (
        <div
          className="cycle-challenge-overlay__boost-badge"
          aria-label={`Boost multiplier ${boostText}`}
        >
          {boostText}
        </div>
      )}

    </div>
  );
};

CycleChallengeOverlay.propTypes = {
  challenge: PropTypes.shape({
    type: PropTypes.string,
    cycleState: PropTypes.string,
    dimFactor: PropTypes.number,
    phaseProgressPct: PropTypes.number,
    currentPhaseIndex: PropTypes.number,
    totalPhases: PropTypes.number,
    currentPhase: PropTypes.shape({
      hiRpm: PropTypes.number,
      loRpm: PropTypes.number
    }),
    rider: PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string
    }),
    swapAllowed: PropTypes.bool,
    boostMultiplier: PropTypes.number,
    baseReqSatisfiedForRider: PropTypes.bool,
    cadenceFlags: PropTypes.shape({
      lostSignal: PropTypes.bool,
      stale: PropTypes.bool,
      smoothed: PropTypes.bool,
      implausible: PropTypes.bool
    }),
    waitingForBaseReq: PropTypes.bool,
    clockPaused: PropTypes.bool,
    cycleHealthPct: PropTypes.number,
    status: PropTypes.string
  }),
  onRequestSwap: PropTypes.func,
  // §5A: render the brief success-completion celebration (full green ring + ✓).
  done: PropTypes.bool
};

export default CycleChallengeOverlay;
