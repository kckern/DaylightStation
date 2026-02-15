import React, { memo } from 'react';
import PropTypes from 'prop-types';
import FitnessTreasureBox from '../../FitnessSidebar/FitnessTreasureBox.jsx';
import { useFitnessContext } from '@/context/FitnessContext.jsx';
import './panels.scss';

/**
 * TreasureBoxPanel - Sidebar panel for gamification rewards display
 * 
 * Wraps FitnessTreasureBox with panel-level props and context consumption.
 * Can be clicked to toggle chart/view mode.
 * 
 * Memoized to prevent re-renders from high-frequency context updates (e.g., playback time).
 */
const TreasureBoxPanel = memo(function TreasureBoxPanel({
  visible = true,
  onClick = null,
  className = '',
  ...props
}) => {
  const { treasureBox, fitnessSession } = useFitnessContext();

  if (!visible) return null;

  const handleClick = (event) => {
    if (onClick) {
      onClick(event);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (onClick) {
        onClick(event);
      }
    }
  };

  const panelClasses = [
    'sidebar-panel',
    'sidebar-panel--treasure-box',
    onClick && 'sidebar-panel--clickable',
    className
  ].filter(Boolean).join(' ');

  return (
    <div
      className={panelClasses}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      {...props}
    >
      <FitnessTreasureBox box={treasureBox} session={fitnessSession} />
    </div>
  );
});

TreasureBoxPanel.propTypes = {
  /** Whether the panel is visible */
  visible: PropTypes.bool,
  /** Click handler (for toggle chart, etc.) */
  onClick: PropTypes.func,
  /** Additional CSS classes */
  className: PropTypes.string
};

export default TreasureBoxPanel;
