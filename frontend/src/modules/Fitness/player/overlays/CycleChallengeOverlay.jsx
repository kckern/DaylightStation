import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import {
  getCycleOverlayVisuals,
  polarToCartesian,
  rpmToAngle,
  getBoosterAvatarSlots
} from './cycleOverlayVisuals.js';
import getLogger from '@/lib/logging/Logger.js';
import './CycleChallengeOverlay.scss';

/**
 * CycleChallengeOverlay (Tasks 21 + 22 + 23).
 *
 * Circular ~220px widget that visualises the active cycle challenge:
 *   - Outer status ring (color + opacity from cycleState / dimFactor)
 *   - Outer ring doubles as phase progress sweep (stroke-dashoffset)
 *   - RPM gauge arc (top hemisphere) with tick marks, hi/lo markers, needle (Task 22)
 *   - Target RPM sign anchored to the hi-rpm tick on the gauge arc (Task 22)
 *   - Rider avatar centered, name below
 *   - Segment counter pill bottom center (e.g. "2 / 4")
 *   - Up to 4 booster avatars at the corners (NE/SE/SW/NW) (Task 23)
 *   - Boost multiplier pill (×2.5) below the rider name when >1.0 (Task 23)
 *   - Position cycling (top / middle / bottom) on background tap, localStorage persisted
 *
 * Not in this task: swap modal (Task 24), FitnessPlayer integration (Task 26).
 */

const CYCLE_VIEWBOX_SIZE = 220;
const CYCLE_RING_RADIUS = 100;
const CYCLE_RING_CIRCUMFERENCE = 2 * Math.PI * CYCLE_RING_RADIUS;
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

const CYCLE_POSITION_KEY = 'fitness.cycleChallengeOverlay.position';
const CYCLE_POSITION_ORDER = ['top', 'middle', 'bottom'];

const readStoredPosition = () => {
  if (typeof window === 'undefined' || !window?.localStorage) {
    return CYCLE_POSITION_ORDER[0];
  }
  try {
    const stored = window.localStorage.getItem(CYCLE_POSITION_KEY);
    return CYCLE_POSITION_ORDER.includes(stored) ? stored : CYCLE_POSITION_ORDER[0];
  } catch (_) {
    return CYCLE_POSITION_ORDER[0];
  }
};

const writeStoredPosition = (position) => {
  if (typeof window === 'undefined' || !window?.localStorage) return;
  try {
    window.localStorage.setItem(CYCLE_POSITION_KEY, position);
  } catch (_) {}
};

const firstInitial = (value) => {
  if (typeof value !== 'string') return '?';
  const trimmed = value.trim();
  if (!trimmed) return '?';
  const ch = trimmed.charAt(0).toUpperCase();
  return ch || '?';
};

export const CycleChallengeOverlay = ({ challenge, onRequestSwap }) => {
  const visuals = useMemo(() => getCycleOverlayVisuals(challenge), [challenge]);
  const [position, setPosition] = useState(() => readStoredPosition());

  const logger = useMemo(
    () => getLogger().child({ component: 'cycle-challenge-overlay' }),
    []
  );

  useEffect(() => {
    if (!visuals.visible) return;
    logger.debug('mounted', {
      cycleState: challenge?.cycleState,
      position,
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
  }, [challenge?.cycleState, challenge?.dimFactor]);

  const cyclePosition = useCallback(() => {
    setPosition((current) => {
      const currentIndex = CYCLE_POSITION_ORDER.indexOf(current);
      const nextIndex = (currentIndex + 1) % CYCLE_POSITION_ORDER.length;
      const next = CYCLE_POSITION_ORDER[nextIndex];
      writeStoredPosition(next);
      logger.debug('position-changed', { from: current, to: next });
      return next;
    });
  }, [logger]);

  const handleBackgroundClick = useCallback((event) => {
    event.stopPropagation();
    cyclePosition();
  }, [cyclePosition]);

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      cyclePosition();
    }
  }, [cyclePosition]);

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

  if (!visuals.visible || !challenge) {
    return null;
  }

  const {
    ringColor,
    ringOpacity,
    dimPulse,
    phaseProgress
  } = visuals;

  const targetRpm = Number.isFinite(challenge.currentPhase?.hiRpm)
    ? Math.round(challenge.currentPhase.hiRpm)
    : null;

  const totalPhases = Number.isFinite(challenge.totalPhases)
    ? Math.max(0, challenge.totalPhases)
    : 0;
  const currentPhaseIndex = Number.isFinite(challenge.currentPhaseIndex)
    ? Math.max(0, challenge.currentPhaseIndex)
    : 0;
  const segmentLabel = totalPhases > 0
    ? `${Math.min(totalPhases, currentPhaseIndex + 1)} / ${totalPhases}`
    : '—';

  const riderName = challenge.rider?.name || challenge.rider?.id || '';
  const riderInitial = firstInitial(challenge.rider?.name || challenge.rider?.id);

  const progressOffset = CYCLE_RING_CIRCUMFERENCE * (1 - phaseProgress);

  // --- RPM gauge geometry (Task 22) -----------------------------------------
  const hiRpm = Number.isFinite(challenge.currentPhase?.hiRpm)
    ? challenge.currentPhase.hiRpm
    : null;
  const loRpm = Number.isFinite(challenge.currentPhase?.loRpm)
    ? challenge.currentPhase.loRpm
    : null;
  const currentRpm = Number.isFinite(challenge.currentRpm)
    ? challenge.currentRpm
    : 0;

  const gaugeTicks = [];
  for (let rpm = 0; rpm <= CYCLE_GAUGE_MAX_RPM; rpm += CYCLE_GAUGE_TICK_STEP) {
    const angle = rpmToAngle(rpm, CYCLE_GAUGE_MAX_RPM);
    const inner = polarToCartesian(
      CYCLE_RING_CENTER,
      CYCLE_RING_CENTER,
      CYCLE_GAUGE_RADIUS - CYCLE_GAUGE_TICK_INNER_OFFSET,
      angle
    );
    const outer = polarToCartesian(
      CYCLE_RING_CENTER,
      CYCLE_RING_CENTER,
      CYCLE_GAUGE_RADIUS + CYCLE_GAUGE_TICK_OUTER_OFFSET,
      angle
    );
    gaugeTicks.push({ rpm, inner, outer });
  }

  const arcStart = polarToCartesian(
    CYCLE_RING_CENTER,
    CYCLE_RING_CENTER,
    CYCLE_GAUGE_RADIUS,
    Math.PI
  );
  const arcEnd = polarToCartesian(
    CYCLE_RING_CENTER,
    CYCLE_RING_CENTER,
    CYCLE_GAUGE_RADIUS,
    2 * Math.PI
  );
  const arcPath =
    `M ${arcStart.x} ${arcStart.y} ` +
    `A ${CYCLE_GAUGE_RADIUS} ${CYCLE_GAUGE_RADIUS} 0 0 1 ${arcEnd.x} ${arcEnd.y}`;

  const hiAngle = hiRpm != null ? rpmToAngle(hiRpm, CYCLE_GAUGE_MAX_RPM) : null;
  const loAngle = loRpm != null ? rpmToAngle(loRpm, CYCLE_GAUGE_MAX_RPM) : null;

  const hiTickInner = hiAngle != null
    ? polarToCartesian(
        CYCLE_RING_CENTER, CYCLE_RING_CENTER,
        CYCLE_GAUGE_RADIUS - CYCLE_GAUGE_HILO_INNER_OFFSET, hiAngle
      )
    : null;
  const hiTickOuter = hiAngle != null
    ? polarToCartesian(
        CYCLE_RING_CENTER, CYCLE_RING_CENTER,
        CYCLE_GAUGE_RADIUS + CYCLE_GAUGE_HILO_OUTER_OFFSET, hiAngle
      )
    : null;
  const loTickInner = loAngle != null
    ? polarToCartesian(
        CYCLE_RING_CENTER, CYCLE_RING_CENTER,
        CYCLE_GAUGE_RADIUS - CYCLE_GAUGE_HILO_INNER_OFFSET, loAngle
      )
    : null;
  const loTickOuter = loAngle != null
    ? polarToCartesian(
        CYCLE_RING_CENTER, CYCLE_RING_CENTER,
        CYCLE_GAUGE_RADIUS + CYCLE_GAUGE_HILO_OUTER_OFFSET, loAngle
      )
    : null;

  const needleAngle = rpmToAngle(currentRpm, CYCLE_GAUGE_MAX_RPM);
  const needleTip = polarToCartesian(
    CYCLE_RING_CENTER,
    CYCLE_RING_CENTER,
    CYCLE_GAUGE_RADIUS,
    needleAngle
  );
  const atHi = hiRpm != null && currentRpm >= hiRpm;

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

  const ringStyle = {
    stroke: ringColor,
    strokeDasharray: `${CYCLE_RING_CIRCUMFERENCE}px`,
    strokeDashoffset: `${progressOffset}px`,
    opacity: ringOpacity,
    '--cycle-ring-circumference': `${CYCLE_RING_CIRCUMFERENCE}px`
  };

  // --- Boosters + boost multiplier (Task 23) --------------------------------
  const boosters = getBoosterAvatarSlots(
    Array.isArray(challenge.boostingUsers) ? challenge.boostingUsers : [],
    CYCLE_VIEWBOX_SIZE
  );
  const rawMultiplier = Number.isFinite(challenge.boostMultiplier)
    ? challenge.boostMultiplier
    : 1;
  const showBoostBadge = rawMultiplier > 1;
  const boostText = `×${rawMultiplier.toFixed(1)}`;

  const classNames = ['cycle-challenge-overlay', `cycle-challenge-overlay--pos-${position}`];
  if (challenge.cycleState) {
    classNames.push(`cycle-challenge-overlay--state-${String(challenge.cycleState).toLowerCase()}`);
  }
  if (dimPulse) {
    classNames.push('cycle-challenge-overlay--dim-pulse');
  }

  const swapAllowed = Boolean(challenge.swapAllowed);
  const positionLabel = position;

  const ariaLabel = `Cycle challenge — ${challenge.cycleState || 'state unknown'}, segment ${Math.min(totalPhases, currentPhaseIndex + 1)} of ${totalPhases}, positioned ${positionLabel}. Tap to move.`;

  return (
    <div
      className={classNames.join(' ')}
      onClick={handleBackgroundClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
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
        <circle
          className="cycle-challenge-overlay__ring-progress"
          cx={CYCLE_RING_CENTER}
          cy={CYCLE_RING_CENTER}
          r={CYCLE_RING_RADIUS}
          fill="none"
          strokeWidth={CYCLE_RING_STROKE_WIDTH}
          strokeLinecap="round"
          style={ringStyle}
          transform={`rotate(-90 ${CYCLE_RING_CENTER} ${CYCLE_RING_CENTER})`}
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

          <line
            className={`cycle-needle${atHi ? ' cycle-needle--at-hi' : ''}`}
            x1={CYCLE_RING_CENTER}
            y1={CYCLE_RING_CENTER}
            x2={needleTip.x}
            y2={needleTip.y}
            stroke={atHi ? '#22c55e' : '#e2e8f0'}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle
            className="cycle-needle-hub"
            cx={CYCLE_RING_CENTER}
            cy={CYCLE_RING_CENTER}
            r={3}
            fill={atHi ? '#22c55e' : '#e2e8f0'}
          />
        </g>
      </svg>

      {targetRpm !== null && (
        <div
          className="cycle-challenge-overlay__target"
          aria-label={`Target RPM ${targetRpm}`}
          style={{
            left: `${targetLeftPct}%`,
            top: `${targetTopPct}%`
          }}
        >
          <span className="cycle-challenge-overlay__target-value">{targetRpm}</span>
        </div>
      )}

      <div
        className="cycle-challenge-overlay__current-rpm"
        aria-label={`Current RPM ${Math.round(currentRpm)}`}
      >
        <span className="cycle-challenge-overlay__current-rpm-value">{Math.round(currentRpm)}</span>
        <span className="cycle-challenge-overlay__current-rpm-unit">RPM</span>
      </div>

      <button
        type="button"
        className={`cycle-challenge-overlay__avatar${swapAllowed ? ' is-clickable' : ''}`}
        onClick={handleAvatarClick}
        disabled={!swapAllowed}
        aria-label={`Rider: ${riderName || 'unknown'}${swapAllowed ? ' — tap to swap' : ''}`}
      >
        <span className="cycle-challenge-overlay__avatar-initials">{riderInitial}</span>
      </button>

      {riderName && (
        <div className="cycle-challenge-overlay__rider-name">{riderName}</div>
      )}

      <div
        className="cycle-challenge-overlay__progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(phaseProgress * 100)}
        aria-label={`Phase ${Math.min(totalPhases, currentPhaseIndex + 1)} of ${totalPhases}, ${Math.round(phaseProgress * 100)}% complete`}
      >
        <div
          className="cycle-challenge-overlay__progress-bar-fill"
          style={{ width: `${Math.round(phaseProgress * 100)}%` }}
        />
        <span className="cycle-challenge-overlay__progress-bar-label">
          Phase {segmentLabel}
        </span>
        <span className="cycle-challenge-overlay__progress-bar-pct">
          {Math.round(phaseProgress * 100)}%
        </span>
      </div>

      {boosters.map((b) => (
        <div
          key={`booster-${b.id}`}
          className="cycle-challenge-overlay__booster"
          style={b.style}
          aria-label={`Booster: ${b.id}`}
        >
          {b.initial}
        </div>
      ))}

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
    boostingUsers: PropTypes.arrayOf(PropTypes.string),
    boostMultiplier: PropTypes.number
  }),
  onRequestSwap: PropTypes.func
};

export default CycleChallengeOverlay;
