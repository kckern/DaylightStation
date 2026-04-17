import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { getCycleOverlayVisuals } from './cycleOverlayVisuals.js';
import getLogger from '@/lib/logging/Logger.js';
import './CycleChallengeOverlay.scss';

/**
 * CycleChallengeOverlay (Task 21 skeleton).
 *
 * Circular ~220px widget that visualises the active cycle challenge:
 *   - Outer status ring (color + opacity from cycleState / dimFactor)
 *   - Outer ring doubles as phase progress sweep (stroke-dashoffset)
 *   - Target RPM sign at top (anchors the hi_rpm tick — RPM gauge comes in Task 22)
 *   - Rider avatar centered, name below
 *   - Segment counter pill bottom center (e.g. "2 / 4")
 *   - Position cycling (top / middle / bottom) on background tap, localStorage persisted
 *
 * Not in this task: RPM gauge arc (Task 22), booster avatars (Task 23),
 * swap modal (Task 24), FitnessPlayer integration (Task 26).
 */

const CYCLE_VIEWBOX_SIZE = 220;
const CYCLE_RING_RADIUS = 100;
const CYCLE_RING_CIRCUMFERENCE = 2 * Math.PI * CYCLE_RING_RADIUS;
const CYCLE_RING_CENTER = CYCLE_VIEWBOX_SIZE / 2;
const CYCLE_RING_STROKE_WIDTH = 8;

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

  const ringStyle = {
    stroke: ringColor,
    strokeDasharray: `${CYCLE_RING_CIRCUMFERENCE}px`,
    strokeDashoffset: `${progressOffset}px`,
    opacity: ringOpacity,
    '--cycle-ring-circumference': `${CYCLE_RING_CIRCUMFERENCE}px`
  };

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
      </svg>

      {targetRpm !== null && (
        <div className="cycle-challenge-overlay__target" aria-label={`Target RPM ${targetRpm}`}>
          <span className="cycle-challenge-overlay__target-value">{targetRpm}</span>
          <span className="cycle-challenge-overlay__target-unit">RPM</span>
        </div>
      )}

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
        className="cycle-challenge-overlay__segment-counter"
        role="status"
        aria-label={`Segment ${Math.min(totalPhases, currentPhaseIndex + 1)} of ${totalPhases}`}
      >
        {segmentLabel}
      </div>
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
    swapAllowed: PropTypes.bool
  }),
  onRequestSwap: PropTypes.func
};

export default CycleChallengeOverlay;
