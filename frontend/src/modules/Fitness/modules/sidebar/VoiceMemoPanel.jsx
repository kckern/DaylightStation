import React from 'react';
import PropTypes from 'prop-types';
import FitnessVoiceMemo from '../../FitnessSidebar/FitnessVoiceMemo.jsx';
import './panels.scss';

/**
 * VoiceMemoPanel - Sidebar panel for voice recording trigger
 * 
 * Wraps FitnessVoiceMemo with panel-level visibility and menu integration.
 * Shows record button and opens settings menu.
 */
const VoiceMemoPanel = ({
  visible = true,
  minimal = true,
  menuOpen = false,
  onToggleMenu = null,
  playerRef = null,
  preferredMicrophoneId = '',
  className = '',
  ...props
}) => {
  if (!visible) return null;

  const panelClasses = [
    'sidebar-panel',
    'sidebar-panel--voice-memo',
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={panelClasses} {...props}>
      <FitnessVoiceMemo
        minimal={minimal}
        menuOpen={menuOpen}
        onToggleMenu={onToggleMenu}
        playerRef={playerRef}
        preferredMicrophoneId={preferredMicrophoneId}
      />
    </div>
  );
};

VoiceMemoPanel.propTypes = {
  /** Whether the panel is visible */
  visible: PropTypes.bool,
  /** Use minimal (compact) layout */
  minimal: PropTypes.bool,
  /** Whether the settings menu is currently open */
  menuOpen: PropTypes.bool,
  /** Callback to toggle settings menu */
  onToggleMenu: PropTypes.func,
  /** Reference to video player */
  playerRef: PropTypes.shape({ current: PropTypes.any }),
  /** Preferred microphone device ID */
  preferredMicrophoneId: PropTypes.string,
  /** Additional CSS classes */
  className: PropTypes.string
};

export default VoiceMemoPanel;
