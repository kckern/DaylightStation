import React from 'react';
import PropTypes from 'prop-types';
import "./GovernanceStartBadge.scss";

const START_STATUSES = new Set(['reach-start', 'start-overdue']);

const titleCase = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
};

/**
 * D3 roster badge: an unattended child who has not yet reached the startup
 * zone once shows "Reach {Zone}"; past the 120s window it turns to the warning
 * style. Renders nothing for any other status (met, missing, holding).
 * `statusBadge` is one entry of resolveParticipantGovernanceStatuses().
 */
const GovernanceStartBadge = ({ statusBadge, className = '' }) => {
  if (!statusBadge || !START_STATUSES.has(statusBadge.status)) return null;
  const zone = titleCase(statusBadge.zoneLabel) || 'Zone';
  const overdue = statusBadge.status === 'start-overdue';
  const classes = ['governance-start-badge', overdue ? 'governance-start-badge--overdue' : null, className]
    .filter(Boolean)
    .join(' ');
  return <span className={classes}>{`Reach ${zone}`}</span>;
};

GovernanceStartBadge.propTypes = {
  statusBadge: PropTypes.shape({
    status: PropTypes.string,
    zoneLabel: PropTypes.string,
    remainingMs: PropTypes.number
  }),
  className: PropTypes.string
};

export default GovernanceStartBadge;
