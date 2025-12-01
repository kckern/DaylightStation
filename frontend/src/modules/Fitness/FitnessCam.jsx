import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import FitnessSidebar from './FitnessSidebar.jsx';
import FitnessCamStage from './FitnessCamStage.jsx';
import FullscreenVitalsOverlay from './FitnessPlayerOverlay/FullscreenVitalsOverlay.jsx';
import './FitnessCam.scss';

const FitnessCam = () => {
  const { setMusicOverride } = useFitnessContext();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const sidebarRef = useRef(null);

  useEffect(() => {
    setMusicOverride(true);
    return () => setMusicOverride(null);
  }, [setMusicOverride]);

  const toggleFullscreen = useCallback((e) => {
    // Prevent toggle if clicking on interactive elements that might bubble up
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
    <div className={`fitness-cam-layout ${isFullscreen ? 'fullscreen-mode' : ''}`}>
      <div className="fitness-cam-main" onClick={toggleFullscreen}>
        <FitnessCamStage onOpenSettings={handleOpenSettings} />
        <FullscreenVitalsOverlay visible={isFullscreen} />
      </div>
      <div className={`fitness-cam-sidebar ${isFullscreen ? 'hidden' : ''}`}>
        <FitnessSidebar ref={sidebarRef} mode="cam" />
      </div>
    </div>
  );
};

export default FitnessCam;
