import { useRef, useCallback, useEffect, useMemo } from 'react';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import usePluginStorage from './usePluginStorage';
import { ChartDataBuilder } from '../domain';

const useFitnessPlugin = (pluginId) => {
  const fitnessCtx = useFitnessContext();
  const storage = usePluginStorage(pluginId);
  
  // Fix 8 (bugbash 1B): Memoize historicalParticipants to prevent infinite effect loops
  // Only recompute when session changes, not on every render
  const historicalParticipants = useMemo(() => {
    return fitnessCtx.fitnessSessionInstance?.getHistoricalParticipants?.() || [];
  }, [fitnessCtx.fitnessSessionInstance?.sessionId]);
  
  // Phase 3: Memoized ChartDataBuilder for clean chart data interface
  const chartDataBuilder = useMemo(() => {
    const getSeries = fitnessCtx.getUserTimelineSeries;
    const timebase = fitnessCtx.timelineTimebase;
    const activityMonitor = fitnessCtx.activityMonitor;
    
    if (typeof getSeries !== 'function') return null;
    
    return new ChartDataBuilder({
      getSeries,
      timebase,
      activityMonitor
    });
  }, [fitnessCtx.getUserTimelineSeries, fitnessCtx.timelineTimebase, fitnessCtx.activityMonitor]);
  
  // Lifecycle event handlers (registered via useEffect in app)
  const lifecycleRef = useRef({
    onMount: null,
    onUnmount: null,
    onPause: null,
    onResume: null,
    onSessionEnd: null
  });
  
  // Register lifecycle callbacks
  const registerLifecycle = useCallback((callbacks) => {
    Object.assign(lifecycleRef.current, callbacks);
  }, []);
  
  // Listen for video pause/resume
  useEffect(() => {
    if (fitnessCtx.videoPlayerPaused) {
      lifecycleRef.current.onPause?.();
    } else {
      lifecycleRef.current.onResume?.();
    }
  }, [fitnessCtx.videoPlayerPaused]);
  
  // Listen for session end
  useEffect(() => {
    if (!fitnessCtx.fitnessSession?.sessionId && lifecycleRef.current.onSessionEnd) {
      lifecycleRef.current.onSessionEnd();
    }
  }, [fitnessCtx.fitnessSession?.sessionId]);
  
  return {
    // Session data
    sessionId: fitnessCtx.fitnessSession?.sessionId,
    sessionActive: Boolean(fitnessCtx.fitnessSession?.sessionId),
    sessionInstance: fitnessCtx.fitnessSessionInstance,
    
    // Session actions
    registerSessionScreenshot: (capture) => fitnessCtx.registerSessionScreenshot?.(capture),
    configureSessionScreenshotPlan: (plan) => fitnessCtx.configureSessionScreenshotPlan?.(plan),
    
    // Participants & vitals
    participants: fitnessCtx.participantRoster,
    // Historical participants (all users who have ever been in session, including those who left)
    // Fix 8: Use memoized value instead of calling getHistoricalParticipants() on each render
    historicalParticipants,
    getUserVitals: fitnessCtx.getUserVitals,
    getUserTimelineSeries: fitnessCtx.getUserTimelineSeries,
    
    // Activity Monitor - single source of truth for participant status (Phase 2)
    activityMonitor: fitnessCtx.activityMonitor,
    
    // Chart Data Builder - clean interface for chart data (Phase 3)
    chartDataBuilder,
    
    // Zone & governance
    zones: fitnessCtx.zones,
    governanceState: fitnessCtx.governanceState,
    reportGovernanceMetric: fitnessCtx.reportGovernanceMetric,
    
    // Timeline
    timebase: fitnessCtx.timelineTimebase,
    
    // App events (inter-app communication)
    emitAppEvent: fitnessCtx.emitAppEvent,
    subscribeToAppEvent: fitnessCtx.subscribeToAppEvent,
    
    // App actions
    logAppEvent: (event, payload) => {
      fitnessCtx.fitnessSessionInstance?.logEvent?.(`app_${appId}_${event}`, payload);
    },
    
    // Video control (for overlay apps)
    pauseVideo: fitnessCtx.setVideoPlayerPaused,
    videoPlayerPaused: fitnessCtx.videoPlayerPaused,
    
    // Lifecycle registration
    registerLifecycle,
    
    // localStorage persistence
    storage: {
      get: storage.get,
      set: storage.set,
      clear: storage.clear,
      clearAll: storage.clearAll  // Reset all plugin settings
    }
  };
};

export default useFitnessPlugin;
