import { useRef, useCallback, useEffect, useMemo } from 'react';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import useAppStorage from './useAppStorage';

const useFitnessApp = (appId) => {
  const fitnessCtx = useFitnessContext();
  const storage = useAppStorage(appId);
  
  // Fix 8 (bugbash 1B): Memoize historicalParticipants to prevent infinite effect loops
  // Only recompute when session changes, not on every render
  const historicalParticipants = useMemo(() => {
    return fitnessCtx.fitnessSessionInstance?.getHistoricalParticipants?.() || [];
  }, [fitnessCtx.fitnessSessionInstance?.sessionId]);
  
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
      clearAll: storage.clearAll  // Reset all app settings
    }
  };
};

export default useFitnessApp;
