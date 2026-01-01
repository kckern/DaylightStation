import React, { useState, useCallback, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import useFitnessPlugin from '../../useFitnessPlugin';
import FitnessSidebar from '../../../FitnessSidebar.jsx';
import CameraViewApp from '../CameraViewApp/index.jsx';
import FitnessChartApp from '../FitnessChartApp/index.jsx';
import { FullscreenVitalsOverlay } from '../../../shared/integrations';
import './FitnessSessionApp.scss';

/**
 * FitnessSessionApp - Full session experience plugin with chart, sidebar with camera, and fullscreen overlay
 * 
 * Features:
 * - Chart view as main content with fullscreen toggle
 * - Camera in sidebar (mini mode)
 * - Sidebar with controls and user management
 * - Fullscreen vitals overlay when in fullscreen mode
 * - Music override during active use
 */
const FitnessSessionApp = ({ mode = 'standalone', onClose, config = {}, onMount }) => {
  const {
    collapseSidebar,
    expandSidebar,
    sidebarCollapsed,
    registerLifecycle
  } = useFitnessPlugin('fitness_session');
  
  const [isFullscreen, setIsFullscreen] = useState(false);
  const sidebarRef = useRef(null);

  // Notify container when mounted
  useEffect(() => {
    onMount?.();
  }, [onMount]);

  // Register lifecycle for music override behavior
  useEffect(() => {
    registerLifecycle({
      onMount: () => {
        // Music override now handled by parent shell if needed
      },
      onUnmount: () => {
        // Cleanup handled by shell
      }
    });
  }, [registerLifecycle]);

  // Collapse sidebar when entering fullscreen, expand when exiting
  useEffect(() => {
    if (isFullscreen) {
      collapseSidebar();
    } else {
      expandSidebar();
    }
  }, [isFullscreen, collapseSidebar, expandSidebar]);

  const toggleFullscreen = useCallback((e) => {
    // Prevent toggle if clicking on interactive elements
    if (e.target.closest('button') || e.target.closest('.device-label') || e.target.closest('.control-button')) {
      return;
    }
    setIsFullscreen(prev => !prev);
  }, []);

  const handleOpenSettings = useCallback(() => {
    if (isFullscreen) {
      setIsFullscreen(false);
    }
    // Small delay to ensure transition out of fullscreen if needed
    setTimeout(() => {
      sidebarRef.current?.openSettingsMenu();
    }, 50);
  }, [isFullscreen]);

  return (
    <div className={`fitness-session-app ${isFullscreen ? 'fullscreen-mode' : ''}`}>
      <div 
        className="fitness-session-app__main"
        onClick={toggleFullscreen}
      >
        <div className="fitness-session-app__chart">
          <FitnessChartApp mode="standalone" onClose={() => {}} />
        </div>
        <FullscreenVitalsOverlay visible={isFullscreen} />
      </div>
      <div className={`fitness-session-app__sidebar ${sidebarCollapsed ? 'hidden' : ''}`}>
        <FitnessSidebar
          ref={sidebarRef}
          mode="cam"
          governanceDisabled
          miniCamContent={(
            <div className="fitness-session-app__mini-cam">
              <CameraViewApp mode="mini" onClose={() => {}} />
            </div>
          )}
        />
      </div>
    </div>
  );
};

FitnessSessionApp.propTypes = {
  mode: PropTypes.oneOf(['standalone', 'overlay', 'sidebar', 'mini']),
  onClose: PropTypes.func,
  config: PropTypes.object,
  onMount: PropTypes.func
};

export default FitnessSessionApp;
