import React, { forwardRef } from 'react';
import PropTypes from 'prop-types';
import FitnessMusicPlayer from '../../FitnessSidebar/FitnessMusicPlayer.jsx';
import { useFitnessContext } from '@/context/FitnessContext.jsx';
import './panels.scss';

/**
 * MusicPanel - Sidebar panel for audio streaming player
 * 
 * Wraps FitnessMusicPlayer with panel-level visibility control.
 * Shows album art, playback controls, and volume adjustment.
 */
const MusicPanel = forwardRef(({
  visible = true,
  videoPlayerRef = null,
  videoVolume = null,
  className = '',
  ...props
}, ref) => {
  const { selectedPlaylistId, musicEnabled } = useFitnessContext();

  // Only show when music is enabled and panel is visible
  if (!visible || !musicEnabled) return null;

  const panelClasses = [
    'sidebar-panel',
    'sidebar-panel--music',
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={panelClasses} {...props}>
      <FitnessMusicPlayer
        ref={ref}
        selectedPlaylistId={selectedPlaylistId}
        videoPlayerRef={videoPlayerRef}
        videoVolume={videoVolume}
      />
    </div>
  );
});

MusicPanel.displayName = 'MusicPanel';

MusicPanel.propTypes = {
  /** Whether the panel is visible (also requires musicEnabled) */
  visible: PropTypes.bool,
  /** Reference to video player for volume coordination */
  videoPlayerRef: PropTypes.shape({ current: PropTypes.any }),
  /** Video volume state for coordination */
  videoVolume: PropTypes.object,
  /** Additional CSS classes */
  className: PropTypes.string
};

export default MusicPanel;
