/**
 * usePoseProvider - Simplified hook for modules to consume pose data
 * 
 * Provides a clean interface to PoseContext with automatic lifecycle management.
 */

import { useContext, useEffect, useCallback, useRef } from 'react';
import PoseContext from '../context/PoseContext.jsx';

/**
 * Hook for modules to consume pose data from PoseProvider
 * 
 * @param {Object} options - Configuration options
 * @param {boolean} options.autoStart - Automatically start detection when video source is set
 * @param {function} options.onPoseUpdate - Callback when poses are updated
 * @param {function} options.onMoveEvent - Callback when a move event is detected
 * @param {boolean} options.optional - If true, returns null when outside provider instead of throwing
 */
export const usePoseProvider = (options = {}) => {
  const {
    autoStart = true,
    onPoseUpdate,
    onMoveEvent,
    optional = false,
  } = options;
  
  // Get context directly — usePoseContext/usePoseContextOptional were both
  // trivial useContext(PoseContext) wrappers, and choosing between two
  // different hooks by `optional` violated rules-of-hooks. One hook call,
  // then plain JS decides whether the missing-provider case throws.
  const ctx = useContext(PoseContext);
  if (!ctx && !optional) {
    throw new Error('usePoseContext must be used within a PoseProvider');
  }

  // Track last processed event to avoid duplicates
  const lastMoveEventRef = useRef(null);
  const lastPoseTimestampRef = useRef(0);

  // Pose update callback — hooks must run unconditionally, so the
  // "no provider" case is handled inside each hook, not via an early return.
  useEffect(() => {
    if (!ctx || !onPoseUpdate || ctx.poses.length === 0) return;
    const now = Date.now();
    // Debounce to avoid excessive callbacks
    if (now - lastPoseTimestampRef.current > 16) {
      lastPoseTimestampRef.current = now;
      onPoseUpdate(ctx.poses);
    }
  }, [ctx, ctx?.poses, onPoseUpdate]);

  // Move event callback
  useEffect(() => {
    if (!ctx || !onMoveEvent || ctx.moveEvents.length === 0) return;
    const latest = ctx.moveEvents[ctx.moveEvents.length - 1];
    if (latest && latest !== lastMoveEventRef.current) {
      lastMoveEventRef.current = latest;
      onMoveEvent(latest);
    }
  }, [ctx, ctx?.moveEvents, onMoveEvent]);

  // Auto-start helper
  const setVideoSourceAndStart = useCallback((video) => {
    if (!ctx) return;
    ctx.setVideoSource(video);
    if (autoStart && video) {
      // Small delay to ensure video source is set
      setTimeout(() => {
        ctx.startDetection();
      }, 100);
    }
  }, [ctx, autoStart]);

  // If context not available and optional, return safe defaults
  if (!ctx) {
    return {
      // Pose data
      poses: [],
      hasPose: false,
      primaryPose: null,

      // State
      isReady: false,
      isDetecting: false,
      isLoading: false,
      error: null,
      available: false,

      // Performance
      fps: 0,
      latency: 0,
      backend: null,

      // Controls (no-ops)
      start: () => {},
      stop: () => {},
      setVideoSource: () => {},

      // Move detection
      moveEvents: [],
      registerMoveDetector: () => {},
      unregisterMoveDetector: () => {},
    };
  }

  return {
    // Pose data
    poses: ctx.poses,
    hasPose: ctx.hasPose,
    primaryPose: ctx.primaryPose,
    
    // State
    isReady: ctx.isInitialized && !ctx.error,
    isDetecting: ctx.isDetecting,
    isLoading: ctx.isLoading,
    error: ctx.error,
    available: true,
    
    // Performance
    fps: ctx.fps,
    latency: ctx.latencyMs,
    backend: ctx.backend,
    modelType: ctx.modelType,
    metrics: ctx.metrics,
    
    // Configuration
    config: ctx.config,
    updateConfig: ctx.updateConfig,
    
    // Controls
    initialize: ctx.initialize,
    start: ctx.startDetection,
    stop: ctx.stopDetection,
    setVideoSource: autoStart ? setVideoSourceAndStart : ctx.setVideoSource,
    
    // Move detection
    moveEvents: ctx.moveEvents,
    registerMoveDetector: ctx.registerMoveDetector,
    unregisterMoveDetector: ctx.unregisterMoveDetector,
    clearMoveEvents: ctx.clearMoveEvents,
  };
};

/**
 * Hook specifically for move detector registration
 * Handles automatic cleanup on unmount
 */
export const useMoveDetector = (detector) => {
  const { registerMoveDetector, unregisterMoveDetector, moveEvents } = usePoseProvider({ optional: true });
  
  useEffect(() => {
    if (!detector || !registerMoveDetector) return;
    
    registerMoveDetector(detector);
    
    return () => {
      unregisterMoveDetector?.(detector.id);
    };
    // detector?.id is an intentional proxy — the full object would cause register/unregister thrash
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detector?.id, registerMoveDetector, unregisterMoveDetector]);
  
  // Filter events for this detector
  const detectorEvents = moveEvents?.filter(e => e.detectorId === detector?.id) || [];
  
  return {
    events: detectorEvents,
    latestEvent: detectorEvents[detectorEvents.length - 1] || null,
    repCount: detector?.repCount || 0,
    currentState: detector?.currentState || 'idle',
    confidence: detector?.confidence || 0,
  };
};

export default usePoseProvider;
