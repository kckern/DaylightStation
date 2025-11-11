import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import './FitnessGovernance.scss';

const UI_TEXT = {
  header: 'Governance',
  participantsHeader: 'HR Users'
};

const STATUS_PRIORITY = ['red', 'yellow', 'green', 'init', 'idle', 'off'];

const FitnessGovernance = () => {
  const { governanceState } = useFitnessContext();

  if (!governanceState?.isGoverned) {
    return null;
  }

  const summary = useMemo(() => {
    const state = governanceState || {};
    const status = STATUS_PRIORITY.includes(state.status) ? state.status : 'idle';
    const watchers = Array.isArray(state.watchers) ? state.watchers : [];

    return {
      status,
      watcherCount: watchers.length
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

  return (
    <div className={`fitness-governance ${statusClass}`}>
      <div className="fg-row">
        <div className="fg-lock-icon">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C9.243 2 7 4.243 7 7v3H6c-1.103 0-2 .897-2 2v8c0 1.103.897 2 2 2h12c1.103 0 2-.897 2-2v-8c0-1.103-.897-2-2-2h-1V7c0-2.757-2.243-5-5-5zM9 7c0-1.654 1.346-3 3-3s3 1.346 3 3v3H9V7zm9 13H6v-8h12v8z"/>
            <circle cx="12" cy="16" r="1.5"/>
          </svg>
        </div>
        
        <div className={`fg-status-pill fg-${statusColor}`}>
          {statusColor}
        </div>
        
        <div className="fg-user-count">
          {summary.watcherCount}
        </div>
      </div>
    </div>
  );
};

FitnessGovernance.propTypes = {
  minimal: PropTypes.bool
};

export default FitnessGovernance;
