import React from 'react';
import PropTypes from 'prop-types';
import './StatusBadge.scss';

/**
 * StatusBadge - Visual indicator for governance/system status
 * 
 * Extracted from FitnessGovernance.jsx for reuse.
 */
const StatusBadge = ({
  status = 'gray',
  label,
  pulse = false,
  size = 'md',
  variant = 'filled',
  icon,
  className,
  ...props
}) => {
  const combinedClassName = [
    'status-badge',
    `status-badge--${status}`,
    `status-badge--${size}`,
    `status-badge--${variant}`,
    pulse ? 'status-badge--pulse' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <span className={combinedClassName} {...props}>
      {icon && <span className="status-badge__icon">{icon}</span>}
      {label && <span className="status-badge__label">{label}</span>}
    </span>
  );
};

StatusBadge.propTypes = {
  /** Status color: 'green' | 'yellow' | 'red' | 'gray' */
  status: PropTypes.oneOf(['green', 'yellow', 'red', 'gray', 'blue', 'orange']),
  /** Optional text label */
  label: PropTypes.node,
  /** Enable pulse animation for active states */
  pulse: PropTypes.bool,
  /** Badge size */
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  /** Visual variant */
  variant: PropTypes.oneOf(['filled', 'outline', 'dot-only']),
  /** Optional icon */
  icon: PropTypes.node,
  /** Additional CSS class */
  className: PropTypes.string
};

export default StatusBadge;
