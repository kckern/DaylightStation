import React, { useMemo, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import './FitnessGovernance.scss';

const UI_TEXT = {
  header: 'Governance',
  participantsHeader: 'HR Users'
};

const STATUS_PRIORITY = ['red', 'yellow', 'green', 'init', 'idle', 'off'];

const STRIPE_CONFIG = {
  green: {
    color1: 'rgba(34, 197, 94, 0.3)',
    color2: 'rgba(34, 197, 94, 0.1)',
    speed: 0.5, // seconds
    distance: 28.28,
    direction: 1 // 1 for left-to-right, -1 for right-to-left
  },
  yellow: {
    color1: 'rgba(234, 179, 8, 0.3)',
    color2: 'rgba(234, 179, 8, 0.1)',
    speed: 2,
    distance: 28.28,
    direction: -1
  },
  red: {
    color1: 'rgba(239, 68, 68, 0.3)',
    color2: 'rgba(239, 68, 68, 0.1)',
    speed: 5,
    distance: 28.28,
    direction: -1
  },
  grey: {
    color1: 'rgba(156, 163, 175, 0.3)',
    color2: 'rgba(156, 163, 175, 0.1)',
    speed: 10,
    distance: 28.28,
    direction: 1
  }
};

const FitnessGovernance = () => {
  const { governanceState, triggerChallengeNow } = useFitnessContext();
  const [isExpanded, setIsExpanded] = useState(false);

  if (!governanceState?.isGoverned) {
    return null;
  }

  const summary = useMemo(() => {
    const state = governanceState || {};
    const status = STATUS_PRIORITY.includes(state.status) ? state.status : 'idle';
    const watchers = Array.isArray(state.watchers) ? state.watchers : [];
    const requirements = Array.isArray(state.requirements) ? state.requirements : [];
    const challenge = state.challenge || null;
    const challengeHistory = Array.isArray(state.challengeHistory) ? state.challengeHistory : [];
    const nextChallenge = state.nextChallenge || null;
    const policyName = state.policyName || state.policyId || 'Default';
    const challengeRemaining = Number.isFinite(state.challengeCountdownSeconds)
      ? Math.max(0, state.challengeCountdownSeconds)
      : null;
    const challengeTotal = Number.isFinite(state.challengeCountdownTotal)
      ? Math.max(1, state.challengeCountdownTotal)
      : null;
    const challengeProgress = challengeTotal
      ? Math.max(0, Math.min(1, (challengeTotal - Math.min(challengeRemaining ?? challengeTotal, challengeTotal)) / challengeTotal))
      : 0;
    const nextChallengeRemaining = Number.isFinite(nextChallenge?.remainingSeconds)
      ? Math.max(0, nextChallenge.remainingSeconds)
      : null;
    const nextChallengeDuration = Number.isFinite(nextChallenge?.timeLimitSeconds)
      ? Math.max(1, nextChallenge.timeLimitSeconds)
      : null;
    const formatZoneLabel = (zoneValue) => {
      if (typeof zoneValue !== 'string' || !zoneValue) return null;
      const friendly = zoneValue.replace(/[_-]+/g, ' ');
      return friendly.charAt(0).toUpperCase() + friendly.slice(1);
    };
    const nextChallengeZoneLabel = nextChallenge?.zone ? formatZoneLabel(nextChallenge.zone) : null;
    
    // Calculate grace period progress (0-100%)
    let graceProgress = 0;
    if (status === 'yellow' && state.countdownSecondsRemaining != null) {
      const graceSeconds = state.gracePeriodTotal || 30;
      const remaining = state.countdownSecondsRemaining;
      graceProgress = Math.max(0, Math.min(100, (remaining / graceSeconds) * 100));
    }

    return {
      status,
      watcherCount: watchers.length,
      graceProgress,
      watchers,
      requirements,
      activeUserCount: Number.isFinite(state.activeUserCount) ? state.activeUserCount : null,
      targetUserCount: Number.isFinite(state.targetUserCount) ? state.targetUserCount : null,
      policyName,
      policyId: state.policyId || null,
      videoLocked: Boolean(state.videoLocked),
      challenge,
      challengeHistory,
      challengeRemaining,
      challengeTotal,
      challengeProgress,
      nextChallenge,
      nextChallengeZoneLabel,
      nextChallengeRemaining,
      nextChallengeDuration
    };
  }, [governanceState]);

  const statusClass = `fg-status-${summary.status}`;

  // Map status to display color
  const statusColors = {
    idle: 'grey',
    off: 'grey',
    init: 'grey',
    green: 'green',
    yellow: 'yellow',
    red: 'red'
  };

  const statusColor = statusColors[summary.status] || 'grey';
  const stripeConfig = STRIPE_CONFIG[statusColor] || STRIPE_CONFIG.grey;

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const handleRowKeyDown = useCallback((event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleExpanded();
    }
  }, [toggleExpanded]);

  const handleTriggerChallenge = useCallback(() => {
    if (typeof triggerChallengeNow === 'function') {
      triggerChallengeNow();
    }
  }, [triggerChallengeNow]);

  const nextChallengeCountdownLabel = useMemo(() => {
    if (summary.nextChallengeRemaining == null) {
      return null;
    }
    const seconds = Math.max(0, Math.round(summary.nextChallengeRemaining));
    return `${seconds}`;
  }, [summary.nextChallengeRemaining]);

  return (
    <div className={`fitness-governance ${statusClass}${isExpanded ? ' expanded' : ''}`}>
      <div
        className="fg-row"
        role="button"
        tabIndex={0}
        onClick={toggleExpanded}
        onKeyDown={handleRowKeyDown}
        aria-expanded={isExpanded ? 'true' : 'false'}
      >
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
          {(summary.status === 'green' || summary.status === 'yellow' || summary.status === 'red' || summary.status === 'init') && (
            <svg className="fg-stripes" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id={`diagonalStripes-${statusColor}`} x="0" y="0" width="28.28" height="28.28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect x="0" y="0" width="14.14" height="28.28" fill={stripeConfig.color1} />
                  <rect x="14.14" y="0" width="14.14" height="28.28" fill={stripeConfig.color2} />
                  <animateTransform
                    attributeName="patternTransform"
                    type="translate"
                    from="0 0"
                    to={`${stripeConfig.distance * stripeConfig.direction} 0`}
                    dur={`${stripeConfig.speed}s`}
                    repeatCount="indefinite"
                    additive="sum"
                  />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill={`url(#diagonalStripes-${statusColor})`} />
            </svg>
          )}
          {summary.status === 'yellow' && (
            <div className="fg-grace-progress" style={{ width: `${summary.graceProgress}%` }}></div>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="fg-debug-panel">
          <div className="fg-debug-actions">
            <button
              type="button"
              className="fg-debug-button"
              onClick={handleTriggerChallenge}
              disabled={typeof triggerChallengeNow !== 'function'}
            >
              Force Challenge
            </button>
          </div>
          <div className="fg-debug-summary">
            <div className="fg-debug-label">Active HR Users</div>
            <div className="fg-debug-value">{summary.activeUserCount ?? summary.watcherCount}</div>
            {summary.targetUserCount != null && (
              <div className="fg-debug-meta">Target: {summary.targetUserCount}</div>
            )}
            <div className="fg-debug-meta">Policy: {summary.policyName || 'Default'}</div>
            {summary.videoLocked ? (
              <div className="fg-debug-meta fg-debug-meta--alert">Video locked by challenge</div>
            ) : null}
          </div>

          {summary.challenge ? (
            <div className={`fg-debug-section fg-challenge fg-challenge--${summary.challenge.status || 'pending'}`}>
              <div className="fg-challenge__header">
                <div className="fg-challenge__title">Current Challenge</div>
                {summary.challenge.selectionLabel ? (
                  <span className="fg-challenge__tag">{summary.challenge.selectionLabel}</span>
                ) : null}
                <span className={`fg-challenge__status fg-challenge__status--${summary.challenge.status || 'pending'}`}>
                  {summary.challenge.status === 'pending'
                    ? 'In progress'
                    : summary.challenge.status === 'success'
                      ? 'Completed'
                      : 'Failed'}
                </span>
              </div>
              <div className="fg-challenge__zone">{summary.challenge.zoneLabel || summary.challenge.zone || 'Target zone'}</div>
              <div className="fg-challenge__counts">
                <span className="fg-challenge__count">{summary.challenge.actualCount ?? 0}</span>
                <span className="fg-challenge__count-divider">/</span>
                <span className="fg-challenge__count fg-challenge__count--target">{summary.challenge.requiredCount ?? 0}</span>
                <span className="fg-challenge__count-label">participants</span>
              </div>
              <div className="fg-challenge__progress">
                <div className="fg-challenge__progress-fill" style={{ width: `${Math.round(summary.challengeProgress * 100)}%` }} />
              </div>
              <div className="fg-challenge__meta-row">
                <span className="fg-challenge__time">
                  {summary.challengeRemaining != null && summary.challengeTotal
                    ? `${summary.challengeRemaining}s of ${summary.challengeTotal}s remaining`
                    : summary.challengeRemaining != null
                      ? `${summary.challengeRemaining}s remaining`
                      : 'Waiting for next start'}
                </span>
                {summary.challenge.missingUsers?.length ? (
                  <span className="fg-challenge__missing">Need: {summary.challenge.missingUsers.join(', ')}</span>
                ) : summary.challenge.metUsers?.length ? (
                  <span className="fg-challenge__met">Met: {summary.challenge.metUsers.join(', ')}</span>
                ) : null}
              </div>
            </div>
          ) : null}

          {summary.nextChallenge ? (
            <div className="fg-debug-section fg-next-challenge">
              <div className="fg-debug-label">Next Challenge</div>
              <div className="fg-next-challenge__card">
                <div className="fg-next-challenge__header">
                  <div className="fg-next-challenge__title">
                    {summary.nextChallenge.selectionLabel || summary.nextChallengeZoneLabel || (summary.nextChallenge.zone || 'Upcoming challenge')}
                  </div>
                  {summary.nextChallengeRemaining != null ? (
                    <div className="fg-next-challenge__countdown" aria-label="Seconds until next challenge">
                      {summary.nextChallengeRemaining}s
                    </div>
                  ) : null}
                </div>
                <div className="fg-next-challenge__meta">
                  {summary.nextChallengeZoneLabel ? (
                    <span className="fg-next-challenge__zone">{summary.nextChallengeZoneLabel}</span>
                  ) : summary.nextChallenge.zone ? (
                    <span className="fg-next-challenge__zone">{summary.nextChallenge.zone}</span>
                  ) : null}
                  {(summary.nextChallengeZoneLabel || summary.nextChallenge.zone) && summary.nextChallenge.requiredCount != null ? (
                    <span className="fg-next-challenge__divider">•</span>
                  ) : null}
                  {summary.nextChallenge.requiredCount != null ? (
                    <span className="fg-next-challenge__requirement">{summary.nextChallenge.requiredCount} required</span>
                  ) : null}
                  {summary.nextChallengeDuration != null ? (
                    <>
                      <span className="fg-next-challenge__divider">•</span>
                      <span className="fg-next-challenge__duration">{summary.nextChallengeDuration}s limit</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {summary.challengeHistory.length > 0 ? (
            <div className="fg-debug-section fg-challenge-history">
              <div className="fg-debug-label">Recent Challenges</div>
              <ul className="fg-challenge-history__list">
                {summary.challengeHistory.slice(-4).reverse().map((entry) => {
                  const timestamp = entry?.completedAt || entry?.startedAt;
                  const timeLabel = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                  return (
                    <li
                      key={entry?.id || `${entry?.zone || 'zone'}-${timestamp || Math.random()}`}
                      className={`fg-challenge-history__item fg-challenge-history__item--${entry?.status || 'unknown'}`}
                    >
                      <span className="fg-challenge-history__dot" />
                      <span className="fg-challenge-history__zone">{entry?.zoneLabel || entry?.zone || 'zone'}</span>
                      {entry?.selectionLabel ? (
                        <span className="fg-challenge-history__label">{entry.selectionLabel}</span>
                      ) : null}
                      <span className="fg-challenge-history__status">{entry?.status || ''}</span>
                      <span className="fg-challenge-history__time">{timeLabel}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {summary.watchers.length > 0 && (
            <div className="fg-debug-section">
              <div className="fg-debug-label">Participants</div>
              <div className="fg-chip-row">
                {summary.watchers.map((name) => (
                  <span className="fg-chip" key={name}>{name}</span>
                ))}
              </div>
            </div>
          )}

          <div className="fg-debug-section">
            <div className="fg-debug-label">Rules</div>
            {summary.requirements.length > 0 ? (
              <div className="fg-rule-list">
                {summary.requirements.map((rule, index) => (
                  <div
                    key={`${rule.zone || 'unknown'}-${index}`}
                    className={`fg-rule ${rule.satisfied ? 'fg-rule--ok' : 'fg-rule--pending'}`}
                  >
                    <div className="fg-rule-header">
                      <span className="fg-rule-zone">{rule.zoneLabel || rule.zone || 'Unknown zone'}</span>
                      <span className="fg-rule-status">{rule.satisfied ? 'Satisfied' : 'Needs attention'}</span>
                    </div>
                    <div className="fg-rule-body">
                      <span className="fg-rule-desc">{rule.ruleLabel || String(rule.rule)}</span>
                      <span className="fg-rule-count">{rule.actualCount}/{rule.requiredCount}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="fg-debug-empty">No governance rules active.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

FitnessGovernance.propTypes = {
  minimal: PropTypes.bool
};

export default FitnessGovernance;
