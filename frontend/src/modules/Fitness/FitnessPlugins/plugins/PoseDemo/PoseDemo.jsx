/**
 * PoseDemo - Main plugin component for pose detection demonstration
 * 
 * Features:
 * - Real-time BlazePose skeleton visualization
 * - Fullscreen skeleton view with optional PIP camera
 * - Configurable rendering options via settings panel
 * - Performance metrics display
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import useFitnessPlugin from '../../useFitnessPlugin';
import { PoseProvider } from '../../../context/PoseContext.jsx';
import { usePoseProvider } from '../../../hooks/usePoseProvider.js';
import { Webcam as FitnessWebcam } from '../../../components/FitnessWebcam.jsx';
import SkeletonCanvas from './components/SkeletonCanvas.jsx';
import PoseSettings from './components/PoseSettings.jsx';
import PoseInspector from './components/PoseInspector.jsx';
import ConfidenceMeter from './components/ConfidenceMeter.jsx';
import { calculatePoseConfidence, createConfidenceSmoother } from '../../../lib/pose/poseConfidence.js';
import './PoseDemo.scss';

/**
 * Inner component that consumes PoseProvider
 */
const PoseDemoInner = ({ mode, onClose, config, onMount }) => {
  const plugin = useFitnessPlugin('pose_demo');
  const { registerLifecycle } = plugin || {};
  
  // Refs
  const webcamRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 640, height: 480 });
  
  // UI State
  const [showSettings, setShowSettings] = useState(false);
  const [showPip, setShowPip] = useState(true);
  const [pipCollapsed, setPipCollapsed] = useState(true);
  const [resolution, setResolution] = useState('480p');
  
  // Render Options
  const [renderOptions, setRenderOptions] = useState({
    showKeypoints: true,
    showSkeleton: true,
    showLabels: false,
    showSimplified: false,
    showInspector: false,
    colorScheme: 'rainbow',
    confidenceThreshold: 0.3,
    mirrorHorizontal: true,
    hipCentered: true,
    renderThreshold: 40,
    showConfidenceMeter: true,
  });
  
  // Confidence meter state
  const [poseConfidence, setPoseConfidence] = useState(0);
  const confidenceSmootherRef = useRef(null);

  // Initialize smoother safely
  useEffect(() => {
    if (!confidenceSmootherRef.current && typeof createConfidenceSmoother === 'function') {
      confidenceSmootherRef.current = createConfidenceSmoother(0.3);
    }
  }, []);
  
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
    videoSource,
  } = usePoseProvider({ autoStart: false });

  // Calculate confidence when pose changes
  useEffect(() => {
    if (!confidenceSmootherRef.current) return;

    try {
      if (primaryPose) {
        const result = calculatePoseConfidence(primaryPose);
        const smoothed = confidenceSmootherRef.current(result.overall);
        setPoseConfidence(smoothed);
      } else {
        // Decay confidence when no pose
        const smoothed = confidenceSmootherRef.current(0);
        setPoseConfidence(smoothed);
      }
    } catch (err) {
      console.warn('[PoseDemo] Error calculating confidence:', err);
    }
  }, [primaryPose]);
  
  // Lifecycle
  useEffect(() => {
    onMount?.();
  }, [onMount]);
  
  useEffect(() => {
    registerLifecycle({
      onPause: () => stop(),
      onResume: () => {
        if (webcamRef.current && videoSource) start();
      },
      onSessionEnd: () => stop(),
    });
  }, [registerLifecycle, start, stop, videoSource]);
  
  // Track container dimensions
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
  }, []);
  
  // Handle webcam stream ready
  const handleStreamReady = useCallback(() => {
    const videoEl = webcamRef.current?.getVideoElement?.();
    if (videoEl) {
      setVideoSource(videoEl);
      setTimeout(() => start(), 200);
    }
  }, [setVideoSource, start]);
  
  // Handle resume - ensure video source is set
  const handleResume = useCallback(() => {
    const videoEl = webcamRef.current?.getVideoElement?.();
    if (videoEl) {
      setVideoSource(videoEl);
      setTimeout(() => start(), 100);
    } else {
      // Video not ready yet, will auto-start when onStreamReady fires
      console.warn('[PoseDemo] Video element not ready');
    }
  }, [setVideoSource, start]);
  
  // Handle model/backend changes (requires restart)
  const handleConfigChange = useCallback(async (changes) => {
    const wasDetecting = isDetecting;
    if (wasDetecting) stop();
    
    await updateConfig(changes);
    
    if (wasDetecting) {
      setTimeout(() => start(), 500);
    }
  }, [isDetecting, stop, updateConfig, start]);

  // Memoize video constraints
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

  // Skeleton options
  const skeletonOptions = useMemo(() => ({
    ...renderOptions,
    backgroundColor: '#000', // Black background for standalone
    displayMode: 'standalone',
    sourceWidth: videoConstraints.width.ideal,
    sourceHeight: videoConstraints.height.ideal,
    showGrid: true,
    renderThreshold: renderOptions.renderThreshold,
  }), [renderOptions, videoConstraints]);

  return (
    <div className="pose-demo-app fullscreen-mode">
      {/* Main Skeleton View */}
      <div className="skeleton-fullscreen" ref={containerRef}>
        <SkeletonCanvas
          poses={poses}
          width={dimensions.width}
          height={dimensions.height}
          options={skeletonOptions}
        />
        
        {/* Confidence Meter */}
        {renderOptions.showConfidenceMeter && isDetecting && (
          <ConfidenceMeter
            confidence={poseConfidence}
            threshold={renderOptions.renderThreshold}
            showLabel
            showStatus
            showThresholdWarning
            position="top-right"
            animated
          />
        )}
        
        {/* Loading / Warmup State */}
        {(isLoading || !isDetecting) && (
          <div className="loading-overlay">
            <div className="loading-content">
              <div className="spinner"></div>
              <h3>{isLoading ? 'Starting Vision Engine...' : 'Paused'}</h3>
              <p>{backend} backend • {poseConfig?.modelType || modelType} model</p>
              {!isDetecting && !isLoading && (
                <button className="start-btn" onClick={handleResume}>Resume</button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* PIP Camera View */}
      <div 
        className={`pip-camera ${showPip ? 'visible' : 'hidden'} ${pipCollapsed ? 'collapsed' : ''}`}
        onClick={() => setPipCollapsed(!pipCollapsed)}
        title={pipCollapsed ? 'Expand camera' : 'Collapse camera'}
      >
        {pipCollapsed && <div className="pip-icon">📷</div>}
        <div className={`pip-video-wrapper ${pipCollapsed ? 'pip-hidden' : ''}`}>
          <FitnessWebcam
            ref={webcamRef}
            onStreamReady={handleStreamReady}
            className="pip-video"
            videoConstraints={videoConstraints}
          />
        </div>
      </div>

      {/* UI Controls */}
      <div className="ui-layer">
        {/* Top Right: Settings Toggle */}
        <button 
          className="settings-toggle-btn"
          onClick={() => setShowSettings(true)}
          title="Settings"
        >
          ⚙️
        </button>

        {/* Bottom Left: Stats */}
        <div className="stats-overlay">
          <div className="stat-item">
            <span className="label">FPS</span>
            <span className="value">{fps}</span>
          </div>
          <div className="stat-item">
            <span className="label">LATENCY</span>
            <span className="value">{latency}ms</span>
          </div>
        </div>
      </div>

      {/* Settings Panel */}
      <PoseSettings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        renderOptions={renderOptions}
        onRenderOptionsChange={setRenderOptions}
        modelType={poseConfig?.modelType || modelType}
        onModelTypeChange={type => handleConfigChange({ modelType: type })}
        resolution={resolution}
        onResolutionChange={setResolution}
        backend={backend}
        onBackendChange={b => handleConfigChange({ backend: b })}
        poseConfig={poseConfig}
        onPoseConfigChange={updateConfig}
        showPip={showPip}
        onTogglePip={setShowPip}
      />
      
      {/* Inspector */}
      {renderOptions.showInspector && (
        <PoseInspector 
          pose={primaryPose} 
          onClose={() => setRenderOptions(prev => ({ ...prev, showInspector: false }))} 
        />
      )}
    </div>
  );
};

const PoseDemo = (props) => (
  <PoseProvider autoStart={false}>
    <PoseDemoInner {...props} />
  </PoseProvider>
);

export default PoseDemo;
