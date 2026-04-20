import React, { useState, useCallback, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import useFitnessModule from '@/modules/Fitness/player/useFitnessModule';
import FitnessSidebar from '@/modules/Fitness/player/FitnessSidebar.jsx';
import CameraViewApp from '../CameraViewApp/index.jsx';
import FitnessChart from '../FitnessChart/index.jsx';
import { FullscreenVitalsOverlay } from '@/modules/Fitness/shared/integrations';
import { useFitnessContext } from '@/context/FitnessContext.jsx';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
import './FitnessSessionApp.scss';

/**
 * FitnessSessionApp - Full session experience module with chart, sidebar with camera, and fullscreen overlay
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
  } = useFitnessModule('fitness_session');
  
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const [endError, setEndError] = useState(null);
  const sidebarRef = useRef(null);
  const fitnessCtx = useFitnessContext();
  const activeSessionId = fitnessCtx?.fitnessSessionInstance?.sessionId || null;
  const logger = React.useMemo(() => getLogger().child({ component: 'FitnessSessionApp' }), []);

  const handleEndSession = useCallback(async (e) => {
    // Don't let the tap also toggle fullscreen
    e.stopPropagation();
    e.preventDefault();
    if (!activeSessionId) {
      logger.warn('fitness.end-session.no-active-session');
      return;
    }
    if (endingSession) return;
    const confirmed = typeof window !== 'undefined'
      ? window.confirm('End this fitness session? Subsequent heart-rate readings will start a new session.')
      : true;
    if (!confirmed) return;
    setEndingSession(true);
    setEndError(null);
    try {
      await DaylightAPI(
        `api/v1/fitness/sessions/${activeSessionId}/end`,
        { endTime: Date.now() },
        'POST'
      );
      logger.info('fitness.end-session.ok', { sessionId: String(activeSessionId) });
    } catch (err) {
      logger.error('fitness.end-session.failed', {
        sessionId: String(activeSessionId),
        error: err?.message
      });
      setEndError(err?.message || 'Failed to end session');
    } finally {
      setEndingSession(false);
    }
  }, [activeSessionId, endingSession, logger]);

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
          <FitnessChart mode="standalone" onClose={() => {}} />
          {activeSessionId && !isFullscreen && (
            <button
              type="button"
              className="fitness-session-app__end-session"
              onPointerDown={handleEndSession}
              disabled={endingSession}
              title="Force end the current session so it won't auto-merge with the next workout"
            >
              {endingSession ? 'Ending…' : 'End Session'}
            </button>
          )}
          {endError && !isFullscreen && (
            <div className="fitness-session-app__end-error" role="alert">
              {endError}
            </div>
          )}
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
