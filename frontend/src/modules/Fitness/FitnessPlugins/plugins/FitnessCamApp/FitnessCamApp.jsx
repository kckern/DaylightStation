import React, { useState, useCallback, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import useFitnessPlugin from '../../useFitnessPlugin';
import FitnessSidebar from '../../../FitnessSidebar.jsx';
import CameraViewApp from '../CameraViewApp/index.jsx';
import { FullscreenVitalsOverlay } from '../../../shared/integrations';
import { ChartWidget } from '../../../shared/integrations';
import './FitnessCamApp.scss';

/**
 * FitnessCamApp - Full camera experience plugin with sidebar, chart mode, and fullscreen overlay
 * 
 * Features:
 * - Camera view with fullscreen toggle (click main area)
 * - Chart mode toggle (swap camera for chart view)
 * - Sidebar with controls and user management
 * - Fullscreen vitals overlay when in fullscreen mode
 * - Music override during active use
 */
const FitnessCamApp = ({ mode = 'standalone', onClose, config = {}, onMount }) => {
  const {
    collapseSidebar,
    expandSidebar,
    sidebarCollapsed,
    registerLifecycle
  } = useFitnessPlugin('fitness_cam');
  
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState('cam'); // 'cam' | 'chart'
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

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === 'cam' ? 'chart' : 'cam'));
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
    <div className={`fitness-cam-app ${isFullscreen ? 'fullscreen-mode' : ''}`}>
      <div 
        className={`fitness-cam-app__main ${viewMode === 'chart' ? 'chart-mode' : ''}`} 
        onClick={toggleFullscreen}
      >
        {viewMode === 'cam' && (
          <>
            <div className="fitness-cam-app__stage">
              <CameraViewApp mode="sidebar" onClose={() => {}} />
            </div>
            <FullscreenVitalsOverlay visible={isFullscreen} />
          </>
        )}
        {viewMode === 'chart' && (
          <div className="fitness-cam-app__chart">
            <ChartWidget />
          </div>
        )}
      </div>
      <div className={`fitness-cam-app__sidebar ${sidebarCollapsed ? 'hidden' : ''}`}>
        <FitnessSidebar
          ref={sidebarRef}
          mode="cam"
          governanceDisabled
          viewMode={viewMode}
          onToggleViewMode={toggleViewMode}
          miniCamContent={viewMode === 'chart' ? (
            <div className="fitness-cam-app__mini-cam">
              <CameraViewApp mode="mini" onClose={() => {}} />
            </div>
          ) : null}
        />
      </div>
    </div>
  );
};

FitnessCamApp.propTypes = {
  mode: PropTypes.oneOf(['standalone', 'overlay', 'sidebar', 'mini']),
  onClose: PropTypes.func,
  config: PropTypes.object,
  onMount: PropTypes.func
};

export default FitnessCamApp;
