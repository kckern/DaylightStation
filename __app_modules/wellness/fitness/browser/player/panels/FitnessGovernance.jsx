import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { useFitnessContext } from "../../context/FitnessContext.jsx";
import { StripedProgressBar, useDeadlineCountdown } from "../../shared/index.js";
import "./FitnessGovernance.scss";

const STATUS_PRIORITY = ['locked', 'red', 'warning', 'yellow', 'unlocked', 'green', 'init', 'idle', 'off', 'pending'];

// Statuses with nothing to say: the engine reports 'idle' when it has no
// phase yet, 'off' is a legacy name for the same. The bar is hidden for them
// rather than showing a lock and an empty grey pill.
const SILENT_STATUSES = new Set(['idle', 'off']);

// Words for statuses whose pill has no striped bar. 'pending' is the engine's
// phase before the requirements have ever been met (GovernanceEngine).
const STATUS_TEXT = {
  pending: 'Waiting for riders'
};

// Map status to stripe animation speeds
const STRIPE_SPEEDS = {
  green: 0.5,
  yellow: 2,
  red: 5,
  grey: 10
};

const FitnessGovernance = () => {
  const { governanceState } = useFitnessContext();

  // Self-updating countdown from deadline - only runs interval when deadline is set
  const { progress: graceProgress } = useDeadlineCountdown(
    governanceState?.deadline,
    governanceState?.gracePeriodTotal || 30
  );

  const summary = useMemo(() => {
    const state = governanceState || {};
    const status = STATUS_PRIORITY.includes(state.status) ? state.status : 'idle';

    const nextChallenge = state.nextChallenge || null;
    const nextChallengeRemaining = Number.isFinite(nextChallenge?.remainingSeconds)
      ? Math.max(0, nextChallenge.remainingSeconds)
      : null;

    return {
      status,
      nextChallengeRemaining
    };
  }, [governanceState]);

  const statusClass = `fg-status-${summary.status}`;

  // Map status to display color for shared primitives
  // Phase names: unlocked (green), warning (yellow), locked (red)
  const statusColors = {
    idle: 'gray',
    off: 'gray',
    init: 'gray',
    pending: 'gray',
    unlocked: 'green',
    warning: 'yellow',
    locked: 'red',
    // Legacy names for backwards compatibility
    green: 'green',
    yellow: 'yellow',
    red: 'red'
  };

  const statusColor = statusColors[summary.status] || 'gray';
  const stripeSpeed = STRIPE_SPEEDS[statusColor] || STRIPE_SPEEDS.grey;
  const stripeDirection = statusColor === 'green' ? 'right' : 'left';

  const nextChallengeCountdownLabel = useMemo(() => {
    if (summary.nextChallengeRemaining == null) {
      return null;
    }
    const seconds = Math.max(0, Math.round(summary.nextChallengeRemaining));
    return `${seconds}`;
  }, [summary.nextChallengeRemaining]);

  // 'pending' covers two engine states: a policy whose requirements have never
  // been met (waiting for riders) and no policy at all (reset() clears
  // policyId). Only the first has anything to say.
  const pendingWithoutPolicy = summary.status === 'pending' && !governanceState?.policyId;
  if (!governanceState?.isGoverned || SILENT_STATUSES.has(summary.status) || pendingWithoutPolicy) {
    return null;
  }
  const statusText = STATUS_TEXT[summary.status] || null;

  return (
    <div className={`fitness-governance ${statusClass}`}>
      <div className="fg-row">
        <div className="fg-lock-icon">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C9.243 2 7 4.243 7 7v3H6c-1.103 0-2 .897-2 2v8c0 1.103.897 2 2 2h12c1.103 0 2-.897 2-2v-8c0-1.103-.897-2-2-2h-1V7c0-2.757-2.243-5-5-5zM9 7c0-1.654 1.346-3 3-3s3 1.346 3 3v3H9V7zm9 13H6v-8h12v8z"/>
            <circle cx="12" cy="16" r="1.5"/>
          </svg>
          {nextChallengeCountdownLabel ? (
            <span className="fg-lock-icon__countdown" aria-label="Seconds until next challenge">
              {nextChallengeCountdownLabel}
            </span>
          ) : null}
        </div>
        
        <div className={`fg-status-pill fg-${statusColor}`}>
          {statusText ? <span className="fg-status-text">{statusText}</span> : null}
          {(summary.status === 'unlocked' || summary.status === 'warning' || summary.status === 'locked' ||
            summary.status === 'green' || summary.status === 'yellow' || summary.status === 'red' || summary.status === 'init') && (
            <StripedProgressBar
              value={(summary.status === 'warning' || summary.status === 'yellow') ? graceProgress : 100}
              max={100}
              color={statusColor}
              speed={stripeSpeed}
              direction={stripeDirection}
              height="100%"
              animated={true}
              className="fg-stripe-bar"
            />
          )}
        </div>
      </div>
    </div>
  );
};

FitnessGovernance.propTypes = {
  minimal: PropTypes.bool
};

export default FitnessGovernance;
