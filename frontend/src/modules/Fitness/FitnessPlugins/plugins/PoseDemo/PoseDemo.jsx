/**
 * PoseDemo - Main plugin component for pose detection demonstration
 * 
 * Features:
 * - Real-time BlazePose skeleton visualization
 * - Multiple display modes (overlay, side-by-side, skeleton-only)
 * - Configurable rendering options
 * - Performance metrics display
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import useFitnessPlugin from '../../useFitnessPlugin';
import { PoseProvider } from '../../../context/PoseContext.jsx';
import { usePoseProvider } from '../../../hooks/usePoseProvider.js';
import { Webcam as FitnessWebcam } from '../../../components/FitnessWebcam.jsx';
import SkeletonCanvas from './components/SkeletonCanvas.jsx';
import PoseControls from './components/PoseControls.jsx';
import PerformanceStats from './components/PerformanceStats.jsx';
import MoveEventLog from './components/MoveEventLog.jsx';
import PoseInspector from './components/PoseInspector.jsx';
import './PoseDemo.scss';

/**
 * Inner component that consumes PoseProvider
 */
const PoseDemoInner = ({ mode, onClose, config, onMount }) => {
  const { registerLifecycle } = useFitnessPlugin('pose_demo');
  
  // Refs
  const webcamRef = useRef(null);
  const containerRef = useRef(null);
  const skeletonPanelRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 640, height: 480 });
  const [skeletonDimensions, setSkeletonDimensions] = useState({ width: 640, height: 480 });
  
  // Display state
  const [displayMode, setDisplayMode] = useState('side-by-side');
  const [resolution, setResolution] = useState('480p');
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [renderOptions, setRenderOptions] = useState({
    showKeypoints: true,
    showSkeleton: true,
    showLabels: false,
    showSimplified: false,
    showInspector: false,
    colorScheme: 'rainbow',
    confidenceThreshold: 0.3,
    mirrorHorizontal: true,
  });
  
  // Consume pose provider
  const {
    poses,
    hasPose,
    primaryPose,
    isDetecting,
    isLoading,
    error,
    fps,
    latency,
    backend,
    modelType,
    config: poseConfig,
    updateConfig,
    start,
    stop,
    setVideoSource,
    moveEvents,
  } = usePoseProvider({ autoStart: false });
  
  // Lifecycle
  useEffect(() => {
    onMount?.();
  }, [onMount]);
  
  useEffect(() => {
    registerLifecycle({
      onPause: () => {
        stop();
      },
      onResume: () => {
        if (webcamRef.current) {
          start();
        }
      },
      onSessionEnd: () => {
        stop();
      },
    });
  }, [registerLifecycle, start, stop]);
  
  // Track container dimensions for both camera panel and skeleton panel
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const updateDimensions = () => {
      const rect = container.getBoundingClientRect();
      setDimensions({
        width: Math.round(rect.width) || 640,
        height: Math.round(rect.height) || 480,
      });
    };
    
    updateDimensions();
    
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(container);
    
    return () => observer.disconnect();
  }, [displayMode]); // Re-attach when display mode changes
  
  // Track skeleton panel dimensions separately for standalone modes
  useEffect(() => {
    const panel = skeletonPanelRef.current;
    if (!panel) return;
    
    const updateSkeletonDimensions = () => {
      const rect = panel.getBoundingClientRect();
      setSkeletonDimensions({
        width: Math.round(rect.width) || 640,
        height: Math.round(rect.height) || 480,
      });
    };
    
    updateSkeletonDimensions();
    
    const observer = new ResizeObserver(updateSkeletonDimensions);
    observer.observe(panel);
    
    return () => observer.disconnect();
  }, [displayMode]);
  
  // Handle webcam stream ready
  const handleStreamReady = useCallback(() => {
    // Get the video element from webcam
    const videoEl = webcamRef.current?.getVideoElement?.() 
      || document.querySelector('.pose-demo-app .fitness-webcam-video');
    
    if (videoEl) {
      setVideoSource(videoEl);
      // Auto-start detection
      setTimeout(() => start(), 200);
    }
  }, [setVideoSource, start]);
  
  // Handle model type change
  const handleModelTypeChange = useCallback(async (newType) => {
    const wasDetecting = isDetecting;
    if (wasDetecting) stop();
    
    await updateConfig({ modelType: newType });
    
    if (wasDetecting) {
      setTimeout(() => start(), 500);
    }
  }, [isDetecting, stop, updateConfig, start]);

  // Handle backend change
  const handleBackendChange = useCallback(async (newBackend) => {
    // Backend switch is handled internally by service, but we might want to pause/resume if needed
    // The service's updateConfig now handles backend switching dynamically
    await updateConfig({ backend: newBackend });
  }, [updateConfig]);
  
  // Toggle detection
  const handleToggleDetection = useCallback(() => {
    if (isDetecting) {
      stop();
    } else {
      start();
    }
  }, [isDetecting, start, stop]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);
  
  // Compute layout class
  const layoutClass = useMemo(() => {
    const classes = ['pose-demo-app', `mode-${mode}`, `display-${displayMode}`];
    if (controlsCollapsed) classes.push('controls-collapsed');
    return classes.join(' ');
  }, [mode, displayMode, controlsCollapsed]);
  
  // Should show camera in current display mode?
  // Note: Camera always renders to keep stream active, but may be visually hidden
  const showCamera = true;
  const hideCamera = displayMode === 'skeleton-only';
  const showOverlaySkeleton = displayMode === 'overlay';
  const showSideSkeleton = displayMode === 'side-by-side' || displayMode === 'skeleton-only';
  
  // Memoize video constraints to prevent camera restarts on re-renders
  const videoConstraints = useMemo(() => {
    const resMap = {
      '240p': { width: 320, height: 240 },
      '480p': { width: 640, height: 480 },
      '720p': { width: 1280, height: 720 },
      '1080p': { width: 1920, height: 1080 },
    };
    const { width, height } = resMap[resolution] || resMap['480p'];
    
    return {
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: 30 },
      facingMode: 'user',
    };
  }, [resolution]);

  // Memoize skeleton options to prevent re-render loops
  const overlaySkeletonOptions = useMemo(() => ({
    ...renderOptions,
    displayMode: 'overlay',
    showGrid: false,
  }), [renderOptions]);

  const standaloneSkeletonOptions = useMemo(() => ({
    ...renderOptions,
    backgroundColor: '#1a1a1a',
    displayMode: 'standalone',
    sourceWidth: 1280,
    sourceHeight: 720,
    showGrid: true,
  }), [renderOptions]);

  return (
    <div className={layoutClass}>
      {/* Main Content Area */}
      <div className="pose-content">
        {/* Camera Panel - always rendered to keep stream active */}
        {showCamera && (
          <div className={`camera-panel ${hideCamera ? 'camera-hidden' : ''}`} ref={containerRef}>
            <FitnessWebcam
              ref={webcamRef}
              onStreamReady={handleStreamReady}
              className="pose-webcam"
              videoConstraints={videoConstraints}
            />
            
            {/* Debug Overlay */}
            <div style={{
              position: 'absolute',
              top: 10,
              left: 10,
              background: 'rgba(0,0,0,0.7)',
              color: '#0f0',
              padding: '5px 10px',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '14px',
              zIndex: 1000,
              pointerEvents: 'none'
            }}>
              FPS: {fps} | {backend} | {poseConfig?.modelType || modelType} | {videoConstraints.width.ideal}x{videoConstraints.height.ideal}
            </div>
            
            {/* Overlay skeleton */}
            {showOverlaySkeleton && (
              <SkeletonCanvas
                poses={poses}
                width={dimensions.width}
                height={dimensions.height}
                options={overlaySkeletonOptions}
                className="skeleton-overlay"
              />
            )}
          </div>
        )}
        
        {/* Side Skeleton Panel (for side-by-side and skeleton-only modes) */}
        {showSideSkeleton && (
          <div className="skeleton-panel" ref={skeletonPanelRef}>
            <SkeletonCanvas
              poses={poses}
              width={skeletonDimensions.width}
              height={skeletonDimensions.height}
              options={standaloneSkeletonOptions}
              className="skeleton-standalone"
            />
          </div>
        )}
        
        {/* Pose Inspector Overlay */}
        {renderOptions.showInspector && (
          <PoseInspector 
            pose={primaryPose} 
            onClose={() => setRenderOptions(prev => ({ ...prev, showInspector: false }))} 
          />
        )}
      </div>
      
      {/* Controls Bar */}
      <div className="controls-bar">
        <div className="controls-left">
          <PoseControls
            displayMode={displayMode}
            onDisplayModeChange={setDisplayMode}
            renderOptions={renderOptions}
            onRenderOptionsChange={setRenderOptions}
            modelType={poseConfig?.modelType || modelType}
            onModelTypeChange={handleModelTypeChange}
            resolution={resolution}
            onResolutionChange={setResolution}
            backend={backend}
            onBackendChange={handleBackendChange}
            isDetecting={isDetecting}
            onToggleDetection={handleToggleDetection}
            isLoading={isLoading}
            collapsed={controlsCollapsed}
            onToggleCollapse={() => setControlsCollapsed(!controlsCollapsed)}
          />
        </div>
        
        <div className="controls-right">
          <PerformanceStats
            fps={fps}
            latency={latency}
            backend={backend}
            modelType={poseConfig?.modelType || modelType}
            isLoading={isLoading}
            isDetecting={isDetecting}
            error={error}
            hasPose={hasPose}
            compact={controlsCollapsed}
          />
          
          {!controlsCollapsed && moveEvents && moveEvents.length > 0 && (
            <MoveEventLog events={moveEvents} />
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Main PoseDemo component - wraps inner component with PoseProvider
 */
const PoseDemo = (props) => {
  return (
    <PoseProvider autoStart={false}>
      <PoseDemoInner {...props} />
    </PoseProvider>
  );
};

export default PoseDemo;
