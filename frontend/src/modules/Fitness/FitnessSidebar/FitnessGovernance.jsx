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
  const { governanceState } = useFitnessContext();
  const [isExpanded, setIsExpanded] = useState(false);

  if (!governanceState?.isGoverned) {
    return null;
  }

  const summary = useMemo(() => {
    const state = governanceState || {};
    const status = STATUS_PRIORITY.includes(state.status) ? state.status : 'idle';
    const watchers = Array.isArray(state.watchers) ? state.watchers : [];
    const requirements = Array.isArray(state.requirements) ? state.requirements : [];
    
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
      targetUserCount: Number.isFinite(state.targetUserCount) ? state.targetUserCount : null
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
        <div className="fg-user-count" aria-label={`Active HR users: ${summary.watcherCount}`}>
          {summary.watcherCount}
        </div>
      </div>

      {isExpanded && (
        <div className="fg-debug-panel">
          <div className="fg-debug-summary">
            <div className="fg-debug-label">Active HR Users</div>
            <div className="fg-debug-value">{summary.activeUserCount ?? summary.watcherCount}</div>
            {summary.targetUserCount != null && (
              <div className="fg-debug-meta">Target: {summary.targetUserCount}</div>
            )}
          </div>

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
