/**
 * PoseContext - Shared pose detection provider for the Fitness module
 * 
 * Provides pose data to all consuming plugins via React Context.
 * Manages a singleton PoseDetectorService instance.
 */

import React, { createContext, useContext, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { getPoseDetectorService, disposePoseDetectorService } from '../domain/pose/PoseDetectorService.js';

const PoseContext = createContext(null);

/**
 * Default configuration for pose detection
 */
const DEFAULT_CONFIG = {
  modelType: 'full',
  enableSmoothing: true,
  minPoseConfidence: 0.5,
  minKeypointConfidence: 0.3,
  maxPoses: 1,
  targetFps: 30,
};

/**
 * PoseProvider component - wrap your app/module to enable pose detection
 */
export const PoseProvider = ({ 
  children, 
  autoStart = false,
  initialConfig = {},
}) => {
  // State
  const [poses, setPoses] = useState([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState(null);
  const [metrics, setMetrics] = useState({
    fps: 0,
    latencyMs: 0,
    backend: null,
    modelType: 'full',
  });
  const [config, setConfig] = useState({ ...DEFAULT_CONFIG, ...initialConfig });
  
  // Refs
  const detectorServiceRef = useRef(null);
  const videoSourceRef = useRef(null);
  const moveDetectorsRef = useRef(new Map());
  const [moveEvents, setMoveEvents] = useState([]);
  
  /**
   * Handle pose updates from detector service
   */
  const handlePoseUpdate = useCallback((newPoses, inferenceMetrics) => {
    setPoses(newPoses);
    setMetrics(prev => ({ ...prev, ...inferenceMetrics }));
    
    // Dispatch to move detectors
    moveDetectorsRef.current.forEach(detector => {
      try {
        const event = detector.processPoses?.(newPoses);
        if (event) {
          setMoveEvents(prev => [...prev.slice(-99), event]);
        }
      } catch (e) {
        console.warn(`[PoseProvider] Move detector ${detector.id} error:`, e);
      }
    });
  }, []);
  
  /**
   * Handle errors from detector service
   */
  const handleError = useCallback((err) => {
    console.error('[PoseProvider] Error:', err);
    setError(err);
  }, []);
  
  /**
   * Handle loading state changes
   */
  const handleLoadingChange = useCallback((loading) => {
    setIsLoading(loading);
    if (!loading) {
      setIsInitialized(true);
    }
  }, []);
  
  /**
   * Initialize the detector service
   */
  const initialize = useCallback(async () => {
    if (detectorServiceRef.current) return;
    
    setError(null);
    
    detectorServiceRef.current = getPoseDetectorService({
      ...config,
      onPoseUpdate: handlePoseUpdate,
      onError: handleError,
      onLoadingChange: handleLoadingChange,
      onMetricsUpdate: setMetrics,
    });
    
    try {
      await detectorServiceRef.current.initialize();
    } catch (e) {
      handleError(e);
    }
  }, [config, handlePoseUpdate, handleError, handleLoadingChange]);
  
  /**
   * Start pose detection
   */
  const startDetection = useCallback(async () => {
    if (!detectorServiceRef.current) {
      await initialize();
    }
    
    if (!videoSourceRef.current) {
      console.warn('[PoseProvider] No video source set');
      return;
    }
    
    try {
      await detectorServiceRef.current.start(videoSourceRef.current);
      setIsDetecting(true);
      setError(null);
    } catch (e) {
      handleError(e);
    }
  }, [initialize, handleError]);
  
  /**
   * Stop pose detection (keeps model loaded)
   */
  const stopDetection = useCallback(() => {
    detectorServiceRef.current?.stop();
    setIsDetecting(false);
  }, []);
  
  /**
   * Set the video source element
   */
  const setVideoSource = useCallback((video) => {
    videoSourceRef.current = video;
    if (video && detectorServiceRef.current) {
      detectorServiceRef.current.setVideoSource(video);
    }
  }, []);
  
  /**
   * Update configuration
   */
  const updateConfig = useCallback(async (partial) => {
    const newConfig = { ...config, ...partial };
    setConfig(newConfig);
    
    if (detectorServiceRef.current) {
      await detectorServiceRef.current.updateConfig(partial);
    }
  }, [config]);
  
  /**
   * Register a move detector
   */
  const registerMoveDetector = useCallback((detector) => {
    if (!detector?.id) {
      console.warn('[PoseProvider] Invalid move detector (missing id)');
      return;
    }
    moveDetectorsRef.current.set(detector.id, detector);
    detector.onActivate?.();
  }, []);
  
  /**
   * Unregister a move detector
   */
  const unregisterMoveDetector = useCallback((id) => {
    const detector = moveDetectorsRef.current.get(id);
    if (detector) {
      detector.onDeactivate?.();
      detector.dispose?.();
      moveDetectorsRef.current.delete(id);
    }
  }, []);
  
  /**
   * Clear move events
   */
  const clearMoveEvents = useCallback(() => {
    setMoveEvents([]);
  }, []);
  
  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      // Dispose all move detectors
      moveDetectorsRef.current.forEach(d => {
        d.onDeactivate?.();
        d.dispose?.();
      });
      moveDetectorsRef.current.clear();
      
      // Dispose detector service
      disposePoseDetectorService();
      detectorServiceRef.current = null;
    };
  }, []);
  
  /**
   * Auto-start if configured
   */
  useEffect(() => {
    if (autoStart && videoSourceRef.current && !isDetecting && !isLoading) {
      startDetection();
    }
  }, [autoStart, isDetecting, isLoading, startDetection]);
  
  // Memoize context value
  const value = useMemo(() => ({
    // Pose data
    poses,
    hasPose: poses.length > 0,
    primaryPose: poses[0] || null,
    
    // State
    isDetecting,
    isLoading,
    isInitialized,
    error,
    
    // Metrics
    metrics,
    fps: metrics.fps,
    latencyMs: metrics.latencyMs,
    backend: metrics.backend,
    modelType: metrics.modelType,
    
    // Configuration
    config,
    updateConfig,
    
    // Controls
    initialize,
    startDetection,
    stopDetection,
    setVideoSource,
    
    // Move detection
    moveEvents,
    activeMoveDetectors: Array.from(moveDetectorsRef.current.keys()),
    registerMoveDetector,
    unregisterMoveDetector,
    clearMoveEvents,
  }), [
    poses,
    isDetecting,
    isLoading,
    isInitialized,
    error,
    metrics,
    config,
    updateConfig,
    initialize,
    startDetection,
    stopDetection,
    setVideoSource,
    moveEvents,
    registerMoveDetector,
    unregisterMoveDetector,
    clearMoveEvents,
  ]);
  
  return (
    <PoseContext.Provider value={value}>
      {children}
    </PoseContext.Provider>
  );
};

/**
 * Hook to access pose context (throws if not within provider)
 */
export const usePoseContext = () => {
  const ctx = useContext(PoseContext);
  if (!ctx) {
    throw new Error('usePoseContext must be used within a PoseProvider');
  }
  return ctx;
};

/**
 * Hook to optionally access pose context (returns null if not within provider)
 */
export const usePoseContextOptional = () => {
  return useContext(PoseContext);
};

export default PoseContext;
