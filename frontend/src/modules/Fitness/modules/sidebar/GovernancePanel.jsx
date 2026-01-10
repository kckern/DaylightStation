import React, { memo } from 'react';
import PropTypes from 'prop-types';
import FitnessGovernance from '../../FitnessSidebar/FitnessGovernance.jsx';
import { useFitnessContext } from '../../../../context/FitnessContext.jsx';
import './panels.scss';

/**
 * GovernancePanel - Sidebar panel for HR governance status display
 * 
 * Wraps FitnessGovernance with panel-level visibility control.
 * Shows lock status, grace period countdown, and next challenge timer.
 * 
 * Memoized to prevent re-renders from high-frequency context updates.
 */
const GovernancePanel = memo(function GovernancePanel({
  visible = true,
  disabled = false,
  className = '',
  ...props
}) => {
  const { governanceState } = useFitnessContext();
  const isGoverned = Boolean(governanceState?.isGoverned);

  // Don't render if disabled or not governed and not forced visible
  if (disabled || (!visible && !isGoverned)) {
    return null;
  }

  const panelClasses = [
    'sidebar-panel',
    'sidebar-panel--governance',
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={panelClasses} {...props}>
      <FitnessGovernance />
    </div>
  );
});

GovernancePanel.propTypes = {
  /** Whether the panel should be visible (may also show when governed) */
  visible: PropTypes.bool,
  /** Completely disable governance panel */
  disabled: PropTypes.bool,
  /** Additional CSS classes */
  className: PropTypes.string
};

export default GovernancePanel;
