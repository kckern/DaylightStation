import { useRef, useCallback, useEffect, useMemo } from 'react';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import usePluginStorage from './usePluginStorage';
import { ChartDataBuilder } from '../domain';

const useFitnessPlugin = (pluginId) => {
  const fitnessCtx = useFitnessContext();
  const storage = usePluginStorage(pluginId);
  
  // Fix 8 (bugbash 1B): Memoize historicalParticipants to prevent infinite effect loops
  // Recompute when session changes OR when timeline series keys change (new participants added)
  // This ensures dropped-out users are included when chart remounts
  const historicalParticipants = useMemo(() => {
    return fitnessCtx.fitnessSessionInstance?.getHistoricalParticipants?.() || [];
  }, [fitnessCtx.fitnessSessionInstance?.sessionId, fitnessCtx.timelineSeriesKeys?.length]);
  
  // Get transfer version from context (triggers re-render when users are transferred)
  const transferVersion = fitnessCtx.transferVersion || 0;
  
  // Memoize transferred users - convert Set to array for stable reference
  // Recalculate when session changes, timeline keys change, or transfer version changes
  const transferredUsersArray = useMemo(() => {
    const set = fitnessCtx.fitnessSessionInstance?.getTransferredUsers?.();
    return set ? Array.from(set) : [];
  }, [fitnessCtx.fitnessSessionInstance?.sessionId, fitnessCtx.timelineSeriesKeys?.length, transferVersion]);
  
  // Convert back to Set with stable reference (only changes when array content changes)
  const transferredUsers = useMemo(() => {
    return new Set(transferredUsersArray);
  }, [transferredUsersArray.join(',')]);
  
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
    isSessionActive: fitnessCtx.isSessionActive,
    sessionStartTime: fitnessCtx.fitnessSession?.startTime
      || fitnessCtx.fitnessSession?.startedAt
      || fitnessCtx.fitnessSessionInstance?.startTime,
    sessionInstance: fitnessCtx.fitnessSessionInstance,
    connected: fitnessCtx.connected,
    
    // Session actions
    registerSessionScreenshot: (capture) => fitnessCtx.registerSessionScreenshot?.(capture),
    configureSessionScreenshotPlan: (plan) => fitnessCtx.configureSessionScreenshotPlan?.(plan),
    
    // Participants & vitals
    participants: fitnessCtx.participantRoster,
    userVitalsMap: fitnessCtx.userVitals,
    userCurrentZones: fitnessCtx.userCurrentZones,
    // Historical participants (all users who have ever been in session, including those who left)
    // Fix 8: Use memoized value instead of calling getHistoricalParticipants() on each render
    historicalParticipants,
    // Transferred users (users whose data was moved to another identity - should be excluded from UI)
    transferredUsers,
    getUserVitals: fitnessCtx.getUserVitals,
    getUserTimelineSeries: fitnessCtx.getUserTimelineSeries,
    getEntityTimelineSeries: fitnessCtx.getEntityTimelineSeries, // Phase 5: Entity series access
    getParticipantTimelineSeries: fitnessCtx.getParticipantTimelineSeries, // Phase 5: Smart entity/user lookup
    getUserZoneThreshold: fitnessCtx.getUserZoneThreshold,
    
    // Phase 5: Entity registry access
    entityRegistry: fitnessCtx.entityRegistry,
    getEntitiesForProfile: fitnessCtx.getEntitiesForProfile,
    getProfileCoinsTotal: fitnessCtx.getProfileCoinsTotal,
    
    // Devices
    heartRateDevices: fitnessCtx.heartRateDevices,
    cadenceDevices: fitnessCtx.cadenceDevices,
    powerDevices: fitnessCtx.powerDevices,
    allDevices: fitnessCtx.allDevices,

    // Activity Monitor - single source of truth for participant status (Phase 2)
    activityMonitor: fitnessCtx.activityMonitor,
    
    // Chart Data Builder - clean interface for chart data (Phase 3)
    chartDataBuilder,
    
    // Zone & governance
    zones: fitnessCtx.zones,
    governanceState: fitnessCtx.governanceState,
    activeGovernancePolicy: fitnessCtx.activeGovernancePolicy,
    governanceChallenge: fitnessCtx.governanceChallenge,
    reportGovernanceMetric: fitnessCtx.reportGovernanceMetric,
    treasureBox: fitnessCtx.treasureBox,
    // TreasureBox instance and helpers for chart live edge and responsive UI
    treasureBoxInstance: fitnessCtx.treasureBoxInstance,
    getLiveSnapshot: fitnessCtx.getTreasureBoxLiveSnapshot,
    getIntervalProgress: fitnessCtx.getTreasureBoxIntervalProgress,

    // Zone configuration for chart slope enforcement
    zoneConfig: fitnessCtx.zoneConfig,

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
    },
    
    // Voice memos
    openVoiceMemoCapture: fitnessCtx.openVoiceMemoCapture,
    voiceMemos: fitnessCtx.voiceMemos,

    // Sidebar control
    sidebarCollapsed: fitnessCtx.sidebarCollapsed,
    collapseSidebar: fitnessCtx.collapseSidebar,
    expandSidebar: fitnessCtx.expandSidebar,
    toggleSidebarCollapsed: fitnessCtx.toggleSidebarCollapsed,
  };
};

export default useFitnessPlugin;
