import React, { memo } from 'react';
import PropTypes from 'prop-types';
import FitnessUsersList from '../../FitnessSidebar/FitnessUsers.jsx';
import './panels.scss';

/**
 * UsersPanel - Sidebar panel for participant avatars and HR monitors
 * 
 * Wraps FitnessUsers with panel-level visibility and event handling.
 * Shows connected devices and allows guest assignment.
 * 
 * Memoized to prevent re-renders from high-frequency context updates.
 */
const UsersPanel = memo(function UsersPanel({
  visible = true,
  onRequestGuestAssignment = null,
  className = '',
  ...props
}) => {
  if (!visible) return null;

  const panelClasses = [
    'sidebar-panel',
    'sidebar-panel--users',
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={panelClasses} {...props}>
      <FitnessUsersList onRequestGuestAssignment={onRequestGuestAssignment} />
    </div>
  );
});

UsersPanel.propTypes = {
  /** Whether the panel is visible */
  visible: PropTypes.bool,
  /** Callback when guest assignment is requested for a device */
  onRequestGuestAssignment: PropTypes.func,
  /** Additional CSS classes */
  className: PropTypes.string
};

export default UsersPanel;
