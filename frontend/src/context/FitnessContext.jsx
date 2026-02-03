import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  FitnessSession,
  setFitnessTimeouts,
  getFitnessTimeouts,
  resolveDisplayLabel,
  resolveZoneThreshold
} from '../hooks/useFitnessSession.js';
import { DeviceAssignmentLedger } from '../hooks/fitness/DeviceAssignmentLedger.js';
import { GuestAssignmentService } from '../hooks/fitness/GuestAssignmentService.js';
import { useZoneLedSync } from '../hooks/fitness/useZoneLedSync.js';
import { playbackLog } from '../modules/Player/lib/playbackLogger.js';
import { getPluginManifest } from '../modules/Fitness/FitnessPlugins/registry.js';
import { VIBRATION_CONSTANTS } from '../modules/Fitness/FitnessPlugins/plugins/VibrationApp/constants.js';

// Phase 3 SSOT: Domain model imports
import ParticipantFactory from '../modules/Fitness/domain/ParticipantFactory.js';

// Create context
const FitnessContext = createContext(null);

const normalizeLabelList = (raw) => {
  if (!Array.isArray(raw)) return [];
  const normalized = raw
    .map(label => (typeof label === 'string' ? label.trim().toLowerCase() : ''))
    .filter(Boolean);
  return Array.from(new Set(normalized));
};

/**
 * Extract plex ID from item's action objects (play, queue, list)
 * This is the canonical way to get the plex ID - not from top-level item.plex
 * @param {Object} item - Item with action objects
 * @returns {string|null} The plex ID or null
 */
const getPlexIdFromActions = (item) => {
  return item?.play?.plex || item?.queue?.plex || item?.list?.plex || null;
};

/**
 * Get a unique identifier for an item
 * Checks action objects first (canonical), then falls back to legacy top-level fields
 * @param {Object} item - Item
 * @returns {string|null}
 */
const getItemIdentifier = (item) => {
  // Prefer action-based plex ID (canonical)
  const actionPlex = getPlexIdFromActions(item);
  if (actionPlex) return actionPlex;
  // Fall back to top-level fields for backward compatibility
  return item?.id || item?.ratingKey || item?.plex || null;
};

const VOICE_MEMO_OVERLAY_INITIAL = {
  open: false,
  mode: null,
  memoId: null,
  autoAccept: false,
  startedAt: null,
  onComplete: null // Fix 5 (bugbash 4B): Callback fired when overlay closes
};

const EMPTY_USER_COLLECTIONS = Object.freeze({
  primary: [],
  secondary: [],
  family: [],
  friends: [],
  other: [],
  all: []
});

const createEmptyOwnership = () => ({
  heartRate: new Map(),
  cadence: new Map()
});

export const calculateIntensity = (x, y, z) => {
  if (x == null || y == null || z == null) return 0;
  return Math.sqrt(x * x + y * y + z * z);
};

// Custom hook for using the context
export const useFitnessContext = () => {
  const context = useContext(FitnessContext);
  if (!context) {
    throw new Error('useFitnessContext must be used within a FitnessProvider');
  }
  return context;
};

// Custom hook for fitness playlist management
export const useFitnessPlaylist = () => {
  const context = useFitnessContext();
  return {
    selectedPlaylistId: context.selectedPlaylistId,
    setSelectedPlaylistId: context.setSelectedPlaylistId,
    playlists: context.plexConfig?.music_playlists || []
  };
};

// Alias for compatibility
export const useFitness = useFitnessContext;

// Provider component
export const FitnessProvider = ({ children, fitnessConfiguration, fitnessPlayQueue: propPlayQueue, setFitnessPlayQueue: propSetPlayQueue }) => {
  const FITNESS_DEBUG = false;
  
  // UI State
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
  const [musicAutoEnabledState, setMusicAutoEnabledState] = useState(false);
  const [musicOverride, setMusicOverride] = useState(null);
  const [lastPlaylistId, setLastPlaylistId] = useState(null);
  const [videoPlayerPaused, setVideoPlayerPaused] = useState(false);
  const [sidebarSizeMode, setSidebarSizeMode] = useState('regular');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [voiceMemoOverlayState, setVoiceMemoOverlayState] = useState(VOICE_MEMO_OVERLAY_INITIAL);
  const [voiceMemoVersion, setVoiceMemoVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const [internalPlayQueue, setInternalPlayQueue] = useState([]);
  const [preferredMicrophoneId, setPreferredMicrophoneId] = useState('');
  const [vibrationState, setVibrationState] = useState({});
  const vibrationTimeoutRefs = useRef({});
  const guestAssignmentLedgerRef = useRef(new DeviceAssignmentLedger());
  const guestAssignmentServiceRef = useRef(null);
  const musicPlayerRef = useRef(null);
  const videoPlayerRef = useRef(null);
  const [ledgerVersion, setLedgerVersion] = useState(0);
  const [transferVersion, setTransferVersion] = useState(0);
  const [currentMedia, setCurrentMedia] = useState(null);
  const [recentlyPlayed, setRecentlyPlayed] = useState([]);

  // App State
  const [activeApp, setActiveApp] = useState(null);
  const [overlayApp, setOverlayApp] = useState(null);
  const [appHistory, setAppHistory] = useState([]);
  const appEventListeners = useRef(new Map());

  // App launch/close methods
  const launchApp = React.useCallback((appId, options = {}) => {
    const manifest = getPluginManifest(appId);
    if (!manifest) return false;
    
    if (options.mode === 'overlay') {
      setOverlayApp({ appId, config: options.config || {} });
    } else {
      setAppHistory(prev => [...prev, activeApp].filter(Boolean));
      setActiveApp({ appId, config: options.config || {} });
    }
    return true;
  }, [activeApp]);

  const closeApp = React.useCallback(() => {
    if (overlayApp) {
      setOverlayApp(null);
    } else if (activeApp) {
      const previous = appHistory[appHistory.length - 1];
      setAppHistory(prev => prev.slice(0, -1));
      setActiveApp(previous || null);
    }
  }, [activeApp, overlayApp, appHistory]);

  const launchOverlayApp = React.useCallback((appId, config = {}) => {
    setOverlayApp({ appId, config });
  }, []);

  const dismissOverlayApp = React.useCallback(() => {
    setOverlayApp(null);
  }, []);

  // App event bus
  const emitAppEvent = React.useCallback((eventType, payload, sourceAppId) => {
    const event = { type: eventType, payload, source: sourceAppId, timestamp: Date.now() };
    const listeners = appEventListeners.current.get(eventType) || [];
    listeners.forEach(cb => { try { cb(event); } catch (e) { console.error(e); } });
    fitnessSessionRef.current?.logEvent?.('app_event', event);
  }, []);

  const subscribeToAppEvent = React.useCallback((eventType, callback) => {
    if (!appEventListeners.current.has(eventType)) {
      appEventListeners.current.set(eventType, []);
    }
    appEventListeners.current.get(eventType).push(callback);
    return () => {
      const listeners = appEventListeners.current.get(eventType) || [];
      const idx = listeners.indexOf(callback);
      if (idx > -1) listeners.splice(idx, 1);
    };
  }, []);

  const registerVideoPlayer = React.useCallback((ref) => {
    videoPlayerRef.current = ref?.current || ref || null;
  }, []);

  const trackRecentlyPlayed = React.useCallback((item) => {
    if (!item) return;
    setRecentlyPlayed(prev => {
      const itemId = getItemIdentifier(item);
      const filtered = prev.filter(p => getItemIdentifier(p) !== itemId);
      return [item, ...filtered].slice(0, 10);
    });
  }, []);

  // Governance Metric Reporting
  const reportGovernanceMetric = React.useCallback((metric) => {
    const normalized = {
      source: 'app',
      appId: metric.appId,
      type: metric.type,           // 'activity', 'completion', 'score'
      value: metric.value,
      userId: metric.userId || null,
      timestamp: Date.now(),
      metadata: metric.metadata || {}
    };
    
    // Log to session
    fitnessSessionRef.current?.logEvent?.('app_governance_metric', normalized);
    
    // Forward to governance engine
    fitnessSessionRef.current?.governanceEngine?.processAppMetric?.(normalized);
  }, []);

  // Session State
  const fitnessSessionRef = useRef(new FitnessSession());
  
  // MEMORY LEAK FIX: Cleanup session on provider unmount
  useEffect(() => {
    return () => {
      const session = fitnessSessionRef.current;
      if (session) {
        // Stop all timers and cleanup state
        if (typeof session.destroy === 'function') {
          session.destroy();
        } else {
          // Fallback if destroy() not yet implemented
          session.reset();
          session.governanceEngine?.reset();
        }
      }
    };
  }, []);
  
  const treasureConfigSignatureRef = useRef(null);
  const configuredSignatureRef = useRef(null);
  const emptyRosterRef = useRef([]);
  const rosterCacheRef = useRef({ signature: null, value: emptyRosterRef.current });
  const [version, setVersion] = useState(0); // Trigger re-render
  const scheduledUpdateRef = useRef(false);
  
  // MEMORY LEAK TRACKING: Count forceUpdate calls and renders for profiling
  const renderStatsRef = useRef({ forceUpdateCount: 0, renderCount: 0, lastResetTime: Date.now() });

  const forceUpdate = React.useCallback(() => {
    renderStatsRef.current.forceUpdateCount++;
    setVersion((v) => v + 1);
  }, []);

  // Batched forceUpdate - coalesces multiple calls within same frame into single render
  // Use this for high-frequency updates (WebSocket messages, etc.)
  const batchedForceUpdate = React.useCallback(() => {
    if (scheduledUpdateRef.current) return; // Already scheduled
    scheduledUpdateRef.current = true;
    requestAnimationFrame(() => {
      scheduledUpdateRef.current = false;
      forceUpdate();
    });
  }, [forceUpdate]);

  // Track render count
  renderStatsRef.current.renderCount++;
  
  // Expose render stats for profiling (auto-resets every 30s when read)
  useEffect(() => {
    window.__fitnessRenderStats = () => {
      const stats = { ...renderStatsRef.current };
      // Reset counters when read (30-second window)
      renderStatsRef.current.forceUpdateCount = 0;
      renderStatsRef.current.renderCount = 0;
      renderStatsRef.current.lastResetTime = Date.now();
      return stats;
    };
    return () => {
      delete window.__fitnessRenderStats;
    };
  }, []);

  // Logging helpers scoped after session ref so sessionId is available
  const voiceMemoLogContext = React.useMemo(() => ({
    source: 'FitnessContext',
    sessionId: () => fitnessSessionRef.current?.sessionId || null
  }), []);

  const logVoiceMemo = React.useCallback((event, payload = {}, options = {}) => {
    const contextValue = typeof voiceMemoLogContext.sessionId === 'function'
      ? voiceMemoLogContext.sessionId()
      : voiceMemoLogContext.sessionId;
    playbackLog('voice-memo', {
      event,
      ...payload
    }, {
      level: options.level || 'info',
      context: {
        source: voiceMemoLogContext.source,
        sessionId: contextValue,
        ...(options.context || {})
      },
      tags: options.tags || undefined
    });
  }, [voiceMemoLogContext]);

  const logFitnessContext = React.useCallback((event, payload = {}, options = {}) => {
    const contextValue = typeof voiceMemoLogContext.sessionId === 'function'
      ? voiceMemoLogContext.sessionId()
      : voiceMemoLogContext.sessionId;
    playbackLog('fitness-context', {
      event,
      ...payload
    }, {
      level: options.level || 'info',
      context: {
        source: 'FitnessContext',
        sessionId: contextValue,
        ...(options.context || {})
      }
    });
  }, [voiceMemoLogContext]);

  const emitVoiceMemoTelemetry = React.useCallback((eventName, payload = {}) => {
    if (!eventName) return;
    const detail = { event: eventName, ...payload };
    logVoiceMemo('telemetry', detail, { level: 'info' });
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('voice-memo-event', { detail }));
      } catch (_) {
        // ignore dispatch errors
      }
    }
  }, [logVoiceMemo]);

  // Configuration extraction
  const {
    fitnessRoot,
    plexConfig,
    musicPlaylists,
    ant_devices,
    usersConfig,
    coinTimeUnitMs,
    zoneConfig,
    governanceConfig,
    equipmentConfig,
    nomusicLabels,
    governedLabels,
    governedTypes
  } = React.useMemo(() => {
    const root = fitnessConfiguration?.fitness ? fitnessConfiguration.fitness : fitnessConfiguration?.plex ? fitnessConfiguration : (fitnessConfiguration || {});
    const plex = root?.plex || {};
    const governance = root?.governance || {};
    const governanceLabelSource = Array.isArray(governance?.governed_labels) && governance.governed_labels.length > 0
      ? governance.governed_labels
      : plex?.governed_labels;
    const normalizedGovernedLabels = normalizeLabelList(governanceLabelSource);
    const governanceTypeSource = Array.isArray(governance?.governed_types) && governance.governed_types.length > 0
      ? governance.governed_types
      : plex?.governed_types;
    const normalizedGovernedTypes = normalizeLabelList(governanceTypeSource);
    const normalizedNomusicLabels = Array.isArray(plex?.nomusic_labels)
      ? plex.nomusic_labels.filter((label) => typeof label === 'string')
      : [];
    return {
      fitnessRoot: root,
      plexConfig: plex,
      musicPlaylists: Array.isArray(plex?.music_playlists) ? plex.music_playlists : [],
      ant_devices: root?.ant_devices || {},
      usersConfig: root?.users || {},
      coinTimeUnitMs: root?.coin_time_unit_ms,
      zoneConfig: root?.zones,
      governanceConfig: {
        ...governance,
        governed_labels: normalizedGovernedLabels,
        governed_types: normalizedGovernedTypes
      },
      equipmentConfig: root?.equipment || [],
      nomusicLabels: normalizedNomusicLabels,
      governedLabels: normalizedGovernedLabels,
      governedTypes: normalizedGovernedTypes
    };
  }, [fitnessConfiguration]);

  // Derived Session State
  const session = fitnessSessionRef.current;
  const fitnessDevices = session.deviceManager.devices;
  const users = session.userManager.users;
  useEffect(() => {
    const ledger = guestAssignmentLedgerRef.current;
    ledger?.setEventJournal?.(session?.eventJournal || null);
    const service = new GuestAssignmentService({ session, ledger });
    guestAssignmentServiceRef.current = service;
    session?.userManager?.setAssignmentLedger?.(ledger, {
      onChange: () => setLedgerVersion((v) => v + 1)
    });
    return () => {
      session?.userManager?.setAssignmentLedger?.(null);
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    // DEBUG: Disabled - suspected cause of empty deviceAssignments on save
    // session.cleanupOrphanGuests?.();
    session.reconcileAssignments?.();
  }, [session, ledgerVersion]);
  
  // Legacy/Compatibility State
  const userGroupLabelMap = React.useMemo(() => {
    const map = new Map();
    const registerGroupLabels = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach((entry) => {
        if (!entry?.name) return;
        const id = entry.id || entry.profileId || entry.name;
        const label = entry.group_label ?? entry.groupLabel ?? null;

        // Index by ID/profileId
        if (id && label && !map.has(id)) {
          map.set(id, label);
        }

        // Also index by display name for lookups that use name instead of ID
        if (entry.name && label && entry.name !== id && !map.has(entry.name)) {
          map.set(entry.name, label);
        }
      });
    };
    registerGroupLabels(usersConfig?.primary);
    registerGroupLabels(usersConfig?.secondary);
    registerGroupLabels(usersConfig?.family);
    registerGroupLabels(usersConfig?.friends);
    registerGroupLabels(usersConfig?.guests);
    return map;
  }, [usersConfig]);
  const lastUpdate = 0;
  const governancePulse = 0;
  const effectiveUsersConfig = usersConfig;
  const normalizedBaseZoneConfig = zoneConfig?.[0] || {};

  const primaryConfigByName = React.useMemo(() => {
    const map = new Map();
    const list = Array.isArray(usersConfig?.primary) ? usersConfig.primary : [];
    list.forEach((entry) => {
      if (!entry?.name) return;
      map.set(entry.name, entry);
      // Also set by ID for direct lookup
      if (entry.id) {
        map.set(entry.id, entry);
      }
    });
    return map;
  }, [usersConfig]);

  const configurationInputs = React.useMemo(() => ({
    ant_devices,
    usersConfig,
    zoneConfig,
    governanceConfig,
    coinTimeUnitMs,
    equipmentConfig,
    nomusicLabels,
    governedLabels,
    governedTypes
  }), [ant_devices, usersConfig, zoneConfig, governanceConfig, coinTimeUnitMs, equipmentConfig, nomusicLabels, governedLabels, governedTypes]);

  const configurationSignature = React.useMemo(() => JSON.stringify({
    ...configurationInputs,
    sessionId: session?.sessionId || 'none'
  }), [configurationInputs, session?.sessionId]);
  
  useEffect(() => {
    if (configuredSignatureRef.current === configurationSignature) {
      return;
    }
    configuredSignatureRef.current = configurationSignature;

    // Configure Timeouts
    const inactive = ant_devices?.timeout?.inactive;
    const remove = ant_devices?.timeout?.remove;
    setFitnessTimeouts({ inactive, remove });

    // Configure User Manager
    session.userManager.configure(usersConfig, zoneConfig);
    session.invalidateUserCaches?.();

    // Configure Governance
    session.governanceEngine.configure(governanceConfig, undefined, { subscribeToAppEvent });
    session.governanceEngine.setCallbacks({
      onPhaseChange: () => forceUpdate(),
      onPulse: () => forceUpdate()
    });

    // Expose governance engine for testing
    if (typeof window !== 'undefined') {
      window.__governanceEngine = session.governanceEngine;
      window.__fitnessSession = session;
      
      // MEMORY LEAK FIX: Add debug helper for memory monitoring
      window.__fitnessMemoryStats = () => {
        const series = session?.timeline?.series || {};
        const seriesCount = Object.keys(series).length;
        const totalPoints = Object.values(series).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
        const perUserCount = session?.treasureBox?.perUser?.size || 0;
        const eventLogSize = session?.eventLog?.length || 0;
        const deviceCount = session?.deviceManager?.devices?.size || 0;
        const userCount = session?.userManager?.users?.size || 0;
        return { 
          seriesCount, 
          totalPoints, 
          perUserCount, 
          eventLogSize,
          deviceCount,
          userCount,
          sessionActive: !!session?.sessionId
        };
      };
    }

    // Configure TreasureBox (lazy init in session, but we can pre-config if needed)
    // Session handles lazy init, but we can push config now if session started.
    // Actually, session.ensureStarted() creates treasureBox.
    
    forceUpdate();
  }, [configurationSignature, ant_devices, usersConfig, zoneConfig, governanceConfig, session, forceUpdate]);

  useEffect(() => {
    const session = fitnessSessionRef.current;
    const box = session?.treasureBox || null;
    if (!box) return;

    const signature = JSON.stringify({
      coinTimeUnitMs: coinTimeUnitMs ?? null,
      zones: zoneConfig ?? null,
      users: usersConfig ?? null
    });

    if (treasureConfigSignatureRef.current !== signature) {
      treasureConfigSignatureRef.current = signature;
      box.configure({
        coinTimeUnitMs,
        zones: zoneConfig,
        users: usersConfig
      });
    }

    box.setMutationCallback(forceUpdate);
    return () => {
      if (box === session?.treasureBox) {
        box.setMutationCallback(null);
      }
    };
  }, [coinTimeUnitMs, zoneConfig, usersConfig, forceUpdate, version]);

  useEffect(() => {
    const session = fitnessSessionRef.current;
    const manager = session?.voiceMemoManager || null;
    if (!manager) return;

    manager.setMutationCallback(forceUpdate);
    return () => {
      if (manager === session?.voiceMemoManager) {
        manager.setMutationCallback(null);
      }
    };
  }, [forceUpdate, version]);

  // Sidebar toggle
  const toggleSidebarSizeMode = React.useCallback(() => {
    setSidebarSizeMode((m) => (m === 'regular' ? 'large' : 'regular'));
  }, []);

  // Sidebar collapse/expand control (for plugins)
  const collapseSidebar = React.useCallback(() => setSidebarCollapsed(true), []);
  const expandSidebar = React.useCallback(() => setSidebarCollapsed(false), []);
  const toggleSidebarCollapsed = React.useCallback(() => setSidebarCollapsed((c) => !c), []);


  // Guest Assignment
  const assignGuestToDevice = React.useCallback((deviceId, assignment) => {
    if (!guestAssignmentServiceRef.current) return;
    const result = guestAssignmentServiceRef.current.assignGuest(deviceId, assignment);
    if (!result?.ok && FITNESS_DEBUG) {
      logFitnessContext('assign-guest-failed', { deviceId, message: result?.message }, { level: 'warn' });
    }
    // Trigger re-render for transferred users (grace period substitution)
    setTransferVersion(v => v + 1);
    forceUpdate();
  }, [forceUpdate]);

  const clearGuestAssignment = React.useCallback((deviceId) => {
    if (!guestAssignmentServiceRef.current) return;
    const result = guestAssignmentServiceRef.current.clearGuest(deviceId);
    if (!result?.ok && FITNESS_DEBUG) {
      logFitnessContext('clear-guest-failed', { deviceId, message: result?.message }, { level: 'warn' });
    }
    forceUpdate();
  }, [forceUpdate]);

  const suppressDeviceUntilNextReading = React.useCallback((deviceId) => {
    if (deviceId == null) return false;

    const session = fitnessSessionRef.current;
    if (!session) return false;

    // Use device ID directly - no slug transformation needed
    const rawId = String(deviceId);

    let mutated = false;

    if (session.deviceManager?.removeDevice) {
      mutated = session.deviceManager.removeDevice(rawId) || mutated;
    } else if (session.deviceManager?.devices instanceof Map) {
      if (session.deviceManager.devices.delete(rawId)) {
        mutated = true;
      }
    }

    const activeIds = session.activeDeviceIds;
    if (activeIds instanceof Set) {
      if (activeIds.delete(rawId)) {
        mutated = true;
      }
    }

    if (mutated) {
      forceUpdate();
    }

    return mutated;
  }, [forceUpdate]);

  // Voice Memos
  const voiceMemos = React.useMemo(() => {
    const raw = fitnessSessionRef.current?.voiceMemoManager?.memos;
    if (!Array.isArray(raw)) return [];
    return raw.map((memo) => ({ ...memo }));
  }, [voiceMemoVersion, version]); // Depend on version too

  const getVoiceMemoById = React.useCallback((memoId) => {
    if (!memoId) return null;
    const targetId = String(memoId);
    return voiceMemos.find((memo) => memo && String(memo.memoId) === targetId) || null;
  }, [voiceMemos]);

  const setVoiceMemoOverlayStateGuarded = React.useCallback((nextState) => {
    setVoiceMemoOverlayState((prev) => {
      if (!nextState || nextState.open !== true) {
        logVoiceMemo('overlay-reset', { reason: 'closed' });
        return VOICE_MEMO_OVERLAY_INITIAL;
      }
      if (
        prev.open === nextState.open
        && prev.mode === nextState.mode
        && prev.memoId === nextState.memoId
        && prev.autoAccept === nextState.autoAccept
      ) {
        return prev;
      }
      logVoiceMemo('overlay-state-change', {
        from: { open: prev.open, mode: prev.mode, memoId: prev.memoId },
        to: { open: nextState.open, mode: nextState.mode, memoId: nextState.memoId }
      }, { level: 'debug' });
      return nextState;
    });
  }, [logVoiceMemo]);

  const addVoiceMemoToSession = React.useCallback((memo) => {
    if (!memo) return null;
    logVoiceMemo('memo-add-request', { memoId: memo.memoId || null });
    let stored = memo;
    try {
      stored = fitnessSessionRef.current?.addVoiceMemo?.(memo) || memo;
    } catch (error) {
      logVoiceMemo('memo-add-error', {
        memoId: memo.memoId || null,
        error: error?.message || String(error)
      }, { level: 'warn' });
    }
    setVoiceMemoVersion((version) => version + 1);
    if (stored) {
      const memoId = stored.memoId || memo.memoId || null;
      logVoiceMemo('memo-added', { memoId });
      emitVoiceMemoTelemetry('voice_memo_added', { memoId });
    }
    return stored;
  }, [emitVoiceMemoTelemetry, logVoiceMemo]);

  const removeVoiceMemoFromSession = React.useCallback((memoId) => {
    if (!memoId) return null;
    logVoiceMemo('memo-remove-request', { memoId });
    let removed = null;
    try {
      removed = fitnessSessionRef.current?.removeVoiceMemo?.(memoId) || null;
    } catch (error) {
      logVoiceMemo('memo-remove-error', {
        memoId,
        error: error?.message || String(error)
      }, { level: 'warn' });
    }
    if (removed) {
      setVoiceMemoVersion((version) => version + 1);
      logVoiceMemo('memo-removed', { memoId: memoId || removed.memoId || null });
      emitVoiceMemoTelemetry('voice_memo_removed', { memoId: memoId || removed.memoId || null });
    }
    return removed;
  }, [emitVoiceMemoTelemetry, logVoiceMemo]);

  const replaceVoiceMemoInSession = React.useCallback((memoId, memo) => {
    if (!memoId || !memo) return null;
    logVoiceMemo('memo-replace-request', { memoId, nextMemoId: memo?.memoId || null });
    let stored = null;
    try {
      stored = fitnessSessionRef.current?.replaceVoiceMemo?.(memoId, memo) || null;
    } catch (error) {
      logVoiceMemo('memo-replace-error', {
        memoId,
        nextMemoId: memo?.memoId || null,
        error: error?.message || String(error)
      }, { level: 'warn' });
    }
    if (stored) {
      setVoiceMemoVersion((version) => version + 1);
      logVoiceMemo('memo-replaced', { memoId, nextMemoId: memo?.memoId || memoId });
      emitVoiceMemoTelemetry('voice_memo_replaced', { memoId, nextMemoId: memo?.memoId || memoId });
    }
    return stored;
  }, [emitVoiceMemoTelemetry, logVoiceMemo]);

  const closeVoiceMemoOverlay = React.useCallback(() => {
    // Fix 5 (bugbash 4B): Capture onComplete before resetting state
    const { onComplete } = voiceMemoOverlayState;
    emitVoiceMemoTelemetry('voice_memo_overlay_close', {
      mode: voiceMemoOverlayState.mode,
      memoId: voiceMemoOverlayState.memoId
    });
    logVoiceMemo('overlay-close', {
      mode: voiceMemoOverlayState.mode,
      memoId: voiceMemoOverlayState.memoId
    });
    
    // Clear pause state when closing overlay (BUG-08)
    setVideoPlayerPaused(false);
    musicPlayerRef.current?.resume?.();
    
    // Directly resume video playback via player ref
    if (videoPlayerRef.current?.play) {
      videoPlayerRef.current.play();
    }

    setVoiceMemoOverlayStateGuarded(VOICE_MEMO_OVERLAY_INITIAL);
    // Fire onComplete callback after state reset
    if (typeof onComplete === 'function') {
      try {
        onComplete();
      } catch (_) {
        // Swallow errors in callback
      }
    }
  }, [emitVoiceMemoTelemetry, logVoiceMemo, setVoiceMemoOverlayStateGuarded, voiceMemoOverlayState]);

  const openVoiceMemoReview = React.useCallback((memoOrId, { autoAccept, fromRecording = false } = {}) => {
    // Pause video and music when opening voice memo review
    setVideoPlayerPaused(true);
    musicPlayerRef.current?.pause?.();

    // Allow optimistic review opens when we have the memo object, even if it hasn't landed in voiceMemos yet.
    const isObject = memoOrId && typeof memoOrId === 'object';
    const id = isObject ? memoOrId.memoId : memoOrId;
    if (!id) return;

    // 4C: Default autoAccept to true for post-recording reviews (not from list)
    const resolvedAutoAccept = autoAccept !== undefined ? autoAccept : (fromRecording || isObject);

    if (!isObject) {
      const existing = getVoiceMemoById(id);
      if (!existing) {
        if (voiceMemos.length > 0) {
          setVoiceMemoOverlayStateGuarded({
            open: true,
            mode: 'list',
            memoId: null,
            autoAccept: false,
            startedAt: Date.now()
          });
        } else {
          setVoiceMemoOverlayStateGuarded(VOICE_MEMO_OVERLAY_INITIAL);
        }
        return;
      }
    }

    setVoiceMemoOverlayStateGuarded({
      open: true,
      mode: 'review',
      memoId: id,
      autoAccept: resolvedAutoAccept,
      startedAt: Date.now()
    });
    logVoiceMemo('overlay-open-review', { memoId: id, autoAccept: resolvedAutoAccept });
    emitVoiceMemoTelemetry('voice_memo_overlay_show', { mode: 'review', memoId: id, autoAccept: resolvedAutoAccept });
  }, [emitVoiceMemoTelemetry, getVoiceMemoById, setVoiceMemoOverlayStateGuarded, voiceMemos]);

  const openVoiceMemoList = React.useCallback(() => {
    // Pause video and music when opening voice memo list
    setVideoPlayerPaused(true);
    musicPlayerRef.current?.pause?.();

    setVoiceMemoOverlayStateGuarded({
      open: true,
      mode: 'list',
      memoId: null,
      autoAccept: false,
      startedAt: Date.now()
    });
    logVoiceMemo('overlay-open-list');
    emitVoiceMemoTelemetry('voice_memo_overlay_show', { mode: 'list', memoId: null });
  }, [emitVoiceMemoTelemetry, setVoiceMemoOverlayStateGuarded]);

  const openVoiceMemoCapture = React.useCallback((memoOrId, { autoAccept = false, fromFitnessVideoEnd = false, onComplete } = {}) => {
    // Pause video and music when opening voice memo overlay
    setVideoPlayerPaused(true);
    musicPlayerRef.current?.pause?.();

    const id = typeof memoOrId === 'string' ? memoOrId : memoOrId?.memoId;
    if (id) {
      const existing = getVoiceMemoById(id);
      if (!existing) {
        if (voiceMemos.length > 0) {
          setVoiceMemoOverlayStateGuarded({
            open: true,
            mode: 'list',
            memoId: null,
            autoAccept: false,
            fromFitnessVideoEnd: false,
            startedAt: Date.now(),
            onComplete: onComplete || null
          });
        } else {
          setVoiceMemoOverlayStateGuarded(VOICE_MEMO_OVERLAY_INITIAL);
        }
        return;
      }
    }
    setVoiceMemoOverlayStateGuarded({
      open: true,
      mode: 'redo',
      memoId: id || null,
      autoAccept, // 4B: Pass autoAccept option for 15-minute rule
      fromFitnessVideoEnd, // Show "How did it go?" vs "How is it going?"
      startedAt: Date.now(),
      onComplete: onComplete || null // Fix 5: Store onComplete callback
    });
    logVoiceMemo('overlay-open-capture', { memoId: id || null, autoAccept, fromFitnessVideoEnd });
    emitVoiceMemoTelemetry('voice_memo_overlay_show', { mode: 'capture', memoId: id || null, autoAccept, fromFitnessVideoEnd });
  }, [emitVoiceMemoTelemetry, getVoiceMemoById, setVoiceMemoOverlayStateGuarded, setVideoPlayerPaused, voiceMemos]);

  React.useEffect(() => {
    if (selectedPlaylistId != null) {
      setLastPlaylistId(selectedPlaylistId);
    }
  }, [selectedPlaylistId]);

  const resolveDefaultPlaylistId = React.useCallback(() => {
    if (lastPlaylistId != null) {
      const existing = musicPlaylists.find((playlist) => String(playlist?.id) === String(lastPlaylistId));
      if (existing && existing.id != null) {
        return existing.id;
      }
    }
    return musicPlaylists[0]?.id ?? null;
  }, [lastPlaylistId, musicPlaylists]);

  const musicAutoEnabled = musicAutoEnabledState;
  const musicEnabled = musicOverride !== null ? musicOverride : musicAutoEnabled;

  React.useEffect(() => {
    if (musicEnabled) {
      if (selectedPlaylistId == null) {
        const targetId = resolveDefaultPlaylistId();
        if (targetId != null) {
          setSelectedPlaylistId(targetId);
        }
      }
    } else if (selectedPlaylistId != null) {
      setSelectedPlaylistId(null);
    }
  }, [musicEnabled, resolveDefaultPlaylistId, selectedPlaylistId]);

  const setMusicAutoEnabled = React.useCallback((nextEnabled) => {
    setMusicAutoEnabledState(Boolean(nextEnabled));
  }, []);

  const setMusicOverrideState = React.useCallback((nextEnabled) => {
    if (nextEnabled === null || nextEnabled === undefined) {
      setMusicOverride(null);
      return;
    }
    const normalized = Boolean(nextEnabled);
    setMusicOverride((prev) => (musicAutoEnabled === normalized ? null : normalized));
  }, [musicAutoEnabled]);

  // Music player control helpers for voice memo coordination
  const pauseMusicPlayer = useCallback(() => {
    musicPlayerRef.current?.pause?.();
  }, []);

  const resumeMusicPlayer = useCallback(() => {
    musicPlayerRef.current?.resume?.();
  }, []);

  // REMOVED: 1-second heartbeat that forced global re-render
  // Countdown displays now use useDeadlineCountdown hook with deadline timestamp
  // This eliminates ~60 unnecessary forceUpdate calls/min during active sessions

  const fitnessPlayQueue = propPlayQueue !== undefined ? propPlayQueue : internalPlayQueue;
  const setFitnessPlayQueue = propSetPlayQueue || setInternalPlayQueue;

  // Auto-enable music when queue contains video with nomusic label
  React.useEffect(() => {
    if (!fitnessPlayQueue || fitnessPlayQueue.length === 0) return;

    const currentItem = fitnessPlayQueue[0];
    if (!currentItem?.labels || !Array.isArray(currentItem.labels)) return;

    const nomusicLabelSet = new Set(nomusicLabels.map(l => l.toLowerCase()));
    const itemLabels = currentItem.labels.map(l =>
      typeof l === 'string' ? l.trim().toLowerCase() : ''
    ).filter(Boolean);

    const hasNomusicLabel = itemLabels.some(label => nomusicLabelSet.has(label));
    if (hasNomusicLabel) {
      setMusicAutoEnabledState(true);
    }
  }, [fitnessPlayQueue, nomusicLabels]);

  // Governance Media Update
  const setGovernanceMedia = React.useCallback((input) => {
    const session = fitnessSessionRef.current;
    if (!session) return;
    
    const media = input ? {
      id: input.id,
      labels: normalizeLabelList(input.labels),
      type: typeof input.type === 'string' ? input.type.trim().toLowerCase() : null
    } : null;
    session.governanceEngine.setMedia(media);
    forceUpdate();
  }, [forceUpdate]);

  const updateGovernancePhase = React.useCallback((nextPhase) => {
    // No-op, handled by engine callbacks
  }, []);
  
  // Vibration utilities
  const handleVibrationEvent = React.useCallback((payload) => {
    const {
      equipmentId,
      equipmentName,
      equipmentType,
      thresholds = VIBRATION_CONSTANTS.DEFAULT_THRESHOLDS,
      data = {},
      timestamp = Date.now()
    } = payload || {};

    if (!equipmentId) return;

    const {
      vibration = false,
      x_axis = null,
      y_axis = null,
      z_axis = null,
      battery = null,
      battery_low = false,
      linkquality = null
    } = data;

    const axes = { x: x_axis ?? null, y: y_axis ?? null, z: z_axis ?? null };
    const intensity = calculateIntensity(axes.x, axes.y, axes.z);
    const normalizedThresholds = thresholds || VIBRATION_CONSTANTS.DEFAULT_THRESHOLDS;

    setVibrationState((prev) => ({
      ...prev,
      [equipmentId]: {
        id: equipmentId,
        name: equipmentName || equipmentId,
        type: equipmentType || null,
        vibration: Boolean(vibration),
        intensity,
        axes,
        thresholds: normalizedThresholds,
        battery: battery ?? prev[equipmentId]?.battery ?? null,
        batteryLow: Boolean(battery_low),
        linkquality: linkquality ?? null,
        lastEvent: timestamp
      }
    }));

    if (vibrationTimeoutRefs.current[equipmentId]) {
      clearTimeout(vibrationTimeoutRefs.current[equipmentId]);
    }

    if (vibration) {
      vibrationTimeoutRefs.current[equipmentId] = setTimeout(() => {
        setVibrationState((prev) => {
          const existing = prev[equipmentId];
          if (!existing) return prev;
          return {
            ...prev,
            [equipmentId]: {
              ...existing,
              vibration: false
            }
          };
        });
      }, VIBRATION_CONSTANTS.ACTIVE_STATE_MS);
    }
  }, []);
  
  // WebSocket subscription using centralized WebSocketService
  useEffect(() => {
    // MEMORY LEAK FIX: Move cleanup refs outside .then() to ensure proper cleanup
    let unsubscribe = null;
    let unsubscribeStatus = null;
    let mounted = true;
    
    // Import dynamically to avoid circular dependencies
    import('../services/WebSocketService').then(({ wsService }) => {
      if (!mounted) return;
      
      // Subscribe to fitness and vibration topics
      unsubscribe = wsService.subscribe(
        ['fitness', 'vibration'],
        (data) => {
          // Guard against malformed or empty data during reconnect churn
          if (!data || typeof data !== 'object') return;
          if (data.topic === undefined && data.type === undefined) return;
          
          if (data?.topic === 'vibration') {
            handleVibrationEvent(data);
            return;
          }
          const session = fitnessSessionRef.current;
          if (session) {
            session.ingestData(data);
            batchedForceUpdate(); // Batched: multiple messages in same frame = 1 render
          }
        }
      );

      // Subscribe to connection status
      unsubscribeStatus = wsService.onStatusChange(({ connected: isConnected }) => {
        setConnected(isConnected);
      });
    });

    // Cleanup subscriptions and vibration timeouts on unmount
    return () => {
      mounted = false;
      unsubscribe?.();
      unsubscribeStatus?.();
      Object.values(vibrationTimeoutRefs.current || {}).forEach(clearTimeout);
      vibrationTimeoutRefs.current = {};
    };
  }, [batchedForceUpdate, handleVibrationEvent]);

  // MEMORY LEAK FIX: Only prune devices when session is active
  const currentSessionId = fitnessSessionRef.current?.sessionId;
  useEffect(() => {
    const session = fitnessSessionRef.current;
    if (!currentSessionId) return;

    const interval = setInterval(() => {
      const timeouts = getFitnessTimeouts();
      session.deviceManager.pruneStaleDevices(timeouts);
      batchedForceUpdate();
    }, 3000);
    return () => clearInterval(interval);
  }, [batchedForceUpdate, currentSessionId]);

  const reconnectFitnessWebSocket = React.useCallback(() => {
    // Use the centralized WebSocketService to reconnect
    import('../services/WebSocketService').then(({ wsService }) => {
      wsService.disconnect();
      wsService.connect();
    });
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // HR Simulation Controller (localhost only)
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (!isLocalhost) return;

    let controller = null;

    import('../modules/Fitness/FitnessSimulationController.js')
      .then(({ FitnessSimulationController }) => {
        import('../services/WebSocketService.js').then(({ wsService }) => {
          controller = new FitnessSimulationController({
            wsService,
            getSession: () => fitnessSessionRef.current,
            zoneConfig: normalizedBaseZoneConfig,
            usersConfig
          });

          window.__fitnessSimController = controller;

          // Broadcast state changes for popup
          controller.onStateChange = () => {
            window.dispatchEvent(new CustomEvent('sim-state-change', {
              detail: controller.getDevices()
            }));
          };

          console.log('[FitnessContext] Simulation controller available on window.__fitnessSimController');
        });
      })
      .catch(err => {
        console.warn('[FitnessContext] Failed to load simulation controller:', err);
      });

    return () => {
      if (controller) {
        controller.destroy();
        delete window.__fitnessSimController;
      }
    };
  }, [normalizedBaseZoneConfig]);

  // Prepare data for context value
  const allDevicesRaw = React.useMemo(() => Array.from(fitnessDevices.values()), [fitnessDevices, version]);
  const allUsers = React.useMemo(() => Array.from(users.values()), [users, version]);
  
  // Phase 2 SSOT: Wrap allDevices with deprecation warning in development
  // Components should use domain selectors (activeHeartRateParticipants, rpmDevices, equipmentDevices) instead
  const allDevices = React.useMemo(() => {
    if (process.env.NODE_ENV === 'development') {
      // Track which components access allDevices for future cleanup
      const warned = new Set();
      return new Proxy(allDevicesRaw, {
        get(target, prop) {
          // Only warn once per property access pattern, and skip common array methods
          if (prop === 'filter' && !warned.has('filter')) {
            warned.add('filter');
            console.warn(
              '[FitnessContext] DEPRECATION: Direct filtering of allDevices detected. ' +
              'Use activeHeartRateParticipants, rpmDevices, or equipmentDevices selectors instead. ' +
              'See docs/ops/fix-fitness-user-consistency.md'
            );
          }
          return Reflect.get(target, prop);
        }
      });
    }
    return allDevicesRaw;
  }, [allDevicesRaw]);
  
  // Categorized device arrays
  const heartRateDevices = React.useMemo(() => allDevicesRaw.filter(d => d.type === 'heart_rate'), [allDevicesRaw]);
  const speedDevices = React.useMemo(() => allDevicesRaw.filter(d => d.type === 'speed'), [allDevicesRaw]);
  const cadenceDevices = React.useMemo(() => allDevicesRaw.filter(d => d.type === 'cadence'), [allDevicesRaw]);
  const jumpropeDevices = React.useMemo(() => allDevicesRaw.filter(d => d.type === 'jumprope'), [allDevicesRaw]);
  const powerDevices = React.useMemo(() => allDevicesRaw.filter(d => d.type === 'power'), [allDevicesRaw]);
  const unknownDevices = React.useMemo(() => allDevicesRaw.filter(d => d.type === 'unknown'), [allDevicesRaw]);

  // ==========================================================================
  // Phase 2 SSOT: Domain-level device selectors
  // ==========================================================================
  // These selectors provide domain-meaningful groupings of devices.
  // UI components should use these instead of filtering allDevices directly.
  
  /**
   * RPM devices: cadence, stationary_bike, ab_roller, jumprope
   * Used by FitnessUsers.jsx for the unified RPM group display
   */
  const rpmDevices = React.useMemo(() => {
    return allDevicesRaw.filter(d =>
      d.type === 'cadence' || 
      d.type === 'stationary_bike' ||
      d.type === 'ab_roller' || 
      d.type === 'jumprope'
    );
  }, [allDevicesRaw]);

  /**
   * Equipment/other devices: everything that's not HR or RPM
   * Used by FitnessUsers.jsx for the "other devices" section
   */
  const equipmentDevices = React.useMemo(() => {
    return allDevicesRaw.filter(d =>
      d.type !== 'heart_rate' && 
      d.type !== 'cadence' &&
      d.type !== 'stationary_bike' && 
      d.type !== 'ab_roller' &&
      d.type !== 'jumprope'
    );
  }, [allDevicesRaw]);

  // ==========================================================================

  const preferGroupLabels = React.useMemo(() => heartRateDevices.length > 1, [heartRateDevices.length]);

  // Log when participant count crosses the threshold for group label display
  const prevPreferGroupLabelsRef = useRef(preferGroupLabels);
  useEffect(() => {
    if (prevPreferGroupLabelsRef.current !== preferGroupLabels) {
      playbackLog('fitness-context', {
        event: 'prefer_group_labels_changed',
        from: prevPreferGroupLabelsRef.current,
        to: preferGroupLabels,
        heartRateDeviceCount: heartRateDevices.length,
        participantNames: heartRateDevices.map(d => d.name || d.id).slice(0, 5)
      }, { level: 'info', context: { source: 'FitnessContext' } });
      prevPreferGroupLabelsRef.current = preferGroupLabels;
    }
  }, [preferGroupLabels, heartRateDevices]);

  const getDisplayLabel = React.useCallback((name, { groupLabelOverride, preferGroupLabel, userId } = {}) => {
    if (!name) return null;
    // Use userId for group label lookup if provided, otherwise use name
    const lookupKey = userId || name;
    const baseGroupLabel = groupLabelOverride !== undefined
      ? groupLabelOverride
      : (lookupKey ? userGroupLabelMap.get(lookupKey) : null);
    const shouldPrefer = typeof preferGroupLabel === 'boolean'
      ? preferGroupLabel
      : (preferGroupLabels && Boolean(baseGroupLabel));
    return resolveDisplayLabel({
      name,
      groupLabel: baseGroupLabel,
      preferGroupLabel: shouldPrefer,
      fallback: 'Participant'
    });
  }, [userGroupLabelMap, preferGroupLabels]);

  const zoneRankMap = React.useMemo(() => {
    if (!Array.isArray(zoneConfig) || zoneConfig.length === 0) return {};
    const sorted = [...zoneConfig].filter(Boolean).sort((a, b) => {
      const aMin = Number.isFinite(a?.min) ? a.min : 0;
      const bMin = Number.isFinite(b?.min) ? b.min : 0;
      if (aMin === bMin) return 0;
      return aMin - bMin;
    });
    const map = {};
    sorted.forEach((zone, index) => {
      if (!zone || zone.id == null) return;
      map[String(zone.id).toLowerCase()] = index;
    });
    return map;
  }, [zoneConfig]);

  const colorToZoneId = React.useMemo(() => {
    if (!Array.isArray(zoneConfig) || zoneConfig.length === 0) return {};
    return zoneConfig.reduce((acc, zone) => {
      if (!zone) return acc;
      const zoneId = zone.id != null ? String(zone.id).toLowerCase() : null;
      const color = zone.color ? String(zone.color).toLowerCase() : null;
      if (zoneId && color) {
        acc[color] = zoneId;
      }
      return acc;
    }, {});
  }, [zoneConfig]);

  const zoneInfoMap = React.useMemo(() => {
    if (!Array.isArray(zoneConfig) || zoneConfig.length === 0) return {};
    return zoneConfig.reduce((acc, zone) => {
      if (!zone || zone.id == null) return acc;
      const key = String(zone.id).toLowerCase();
      acc[key] = {
        id: key,
        name: zone.name || String(zone.id),
        color: zone.color || null
      };
      return acc;
    }, {});
  }, [zoneConfig]);

  const governedLabelSet = React.useMemo(() => new Set(normalizeLabelList(governedLabels)), [governedLabels]);
  const governedTypeSet = React.useMemo(() => new Set(normalizeLabelList(governedTypes)), [governedTypes]);



  const participantRoster = React.useMemo(() => {
    const roster = fitnessSessionRef.current?.roster || [];
    if (!roster || roster.length === 0) {
      rosterCacheRef.current.signature = null;
      rosterCacheRef.current.value = emptyRosterRef.current;
      return rosterCacheRef.current.value;
    }

    const signature = JSON.stringify(
      roster.map((entry) => ({
        name: entry?.name || null,
        hrDeviceId: entry?.hrDeviceId || null,
        heartRate: Number.isFinite(entry?.heartRate) ? Math.round(entry.heartRate) : null,
        zoneId: entry?.zoneId || null,
        zoneColor: entry?.zoneColor || null,
        isActive: entry?.isActive ?? true // SINGLE SOURCE OF TRUTH - include in signature
      }))
    );

    if (rosterCacheRef.current.signature === signature) {
      return rosterCacheRef.current.value;
    }

    rosterCacheRef.current = { signature, value: roster };
    return rosterCacheRef.current.value;
  }, [version]);

  const activeParticipantNames = React.useMemo(() => {
    return participantRoster.map(p => p.name).filter(Boolean);
  }, [participantRoster]);

  // ==========================================================================
  // Phase 3 SSOT: Participant Domain Entities
  // ==========================================================================
  // This is the SINGLE SOURCE OF TRUTH for "who is participating with a heart rate device."
  // All UI components (FitnessUsers, SidebarFooter, GovernanceOverlay, Chart) must consume
  // this selector instead of deriving their own lists from raw devices.
  // 
  // Phase 3 upgrade: Uses ParticipantFactory to create proper domain entities.
  // See: docs/ops/fix-fitness-user-consistency.md
  
  const activeHeartRateParticipants = React.useMemo(() => {
    const inactiveTimeout = ant_devices?.timeout?.inactive ?? 60000;
    
    return ParticipantFactory.fromRoster(participantRoster, {
      devices: heartRateDevices,
      zoneConfig,
      inactiveTimeout,
      getDisplayLabel
    });
  }, [participantRoster, heartRateDevices, zoneConfig, ant_devices, getDisplayLabel]);

  // ==========================================================================
  // Ambient LED Zone Sync (Home Assistant Integration)
  // ==========================================================================
  // Syncs max participant zone to configured HA scenes for ambient lighting
  
  const ambientLedEnabled = React.useMemo(() => {
    const scenes = fitnessRoot?.ambient_led?.scenes;
    return scenes && typeof scenes === 'object' && !!scenes.off;
  }, [fitnessRoot]);

  const zoneLedPayload = React.useMemo(() => {
    if (!ambientLedEnabled) return [];
    return participantRoster.map(p => ({
      zoneId: p.zoneId || null,
      isActive: p.isActive !== false
    }));
  }, [participantRoster, ambientLedEnabled]);

  useZoneLedSync({
    participantRoster: zoneLedPayload,
    sessionActive: !!session.sessionId,
    enabled: ambientLedEnabled,
    householdId: fitnessRoot?._household || null
  });

  // ==========================================================================

  const deviceAssignments = React.useMemo(() => {
    return guestAssignmentLedgerRef.current.snapshot();
  }, [ledgerVersion]);

  const deviceAssignmentMap = React.useMemo(() => {
    const map = new Map();
    deviceAssignments.forEach((entry) => {
      if (!entry || entry.deviceId == null) return;
      map.set(String(entry.deviceId), entry);
    });
    return map;
  }, [deviceAssignments]);

  const getDeviceAssignment = React.useCallback((deviceId) => {
    if (deviceId == null) return null;
    return deviceAssignmentMap.get(String(deviceId)) || null;
  }, [deviceAssignmentMap]);

  const replacedPrimaryPool = React.useMemo(() => {
    if (primaryConfigByName.size === 0) return [];
    const seen = new Set();
    const pool = [];
    deviceAssignments.forEach((assignment) => {
      const baseUserName = assignment?.metadata?.baseUserName || assignment?.metadata?.base_user_name;
      if (!baseUserName) return;
      const config = primaryConfigByName.get(baseUserName);
      if (!config) return;
      // Use explicit ID from config
      const id = config.id || config.profileId;
      if (!id) {
        getLogger().warn('fitness.context.pool_config_missing_id', { name: config.name });
        return;
      }
      if (seen.has(id)) return;
      seen.add(id);
      pool.push({
        id,
        name: config.name,
        profileId: id,
        category: 'Family',
        source: 'Family',
        isPrimary: true
      });
    });
    return pool;
  }, [deviceAssignments, primaryConfigByName]);

  const participantLookupByDevice = React.useMemo(() => {
    const map = new Map();
    const addKey = (key, entry) => {
      if (key === undefined || key === null) return;
      const normalized = String(key);
      if (!normalized) return;
      if (!map.has(normalized)) {
        map.set(normalized, entry);
      }
    };
    participantRoster.forEach((entry) => {
      if (!entry) return;
      const primaryKey = entry.hrDeviceId ?? entry.deviceId ?? entry.device_id ?? entry.antDeviceId ?? entry.device?.id ?? entry.device?.deviceId;
      addKey(primaryKey, entry);
    });
    return map;
  }, [participantRoster]);

  const participantLookupByName = React.useMemo(() => {
    const map = new Map();
    participantRoster.forEach((entry) => {
      if (!entry?.name) return;
      const key = String(entry.name).trim().toLowerCase();
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, entry);
      }
    });
    return map;
  }, [participantRoster]);

  const userVitalsMap = React.useMemo(() => {
    const map = new Map();
    allUsers.forEach((user) => {
      if (!user || !user.id) return;
      const key = user.id;
      const data = user.currentData || {};
      
      const deviceId = user.hrDeviceId ? String(user.hrDeviceId) : null;
      const ledgerEntry = deviceId ? deviceAssignmentMap.get(deviceId) : null;
      const isGuest = Boolean(ledgerEntry);
      const source = isGuest ? 'Guest' : 'Primary';
      const displayLabel = getDisplayLabel(user.name, { userId: user.id });

      map.set(key, {
        name: user.name,
        heartRate: data.heartRate,
        zoneId: data.zone,
        zoneName: data.zoneName,
        zoneColor: data.color,
        targetHeartRate: data.targetHeartRate,
        rangeMin: data.rangeMin,
        rangeMax: data.rangeMax,
        progress: data.progressToNextZone,
        showBar: data.showProgress,
        nextZoneId: data.nextZoneId,
        
        source,
        profileId: user.id,
        deviceId,
        isGuest: !!isGuest,
        displayLabel
      });
    });
    return map;
  }, [allUsers, deviceAssignmentMap, getDisplayLabel]);

  const userCollections = React.useMemo(() => {
    const collections = session?.userCollections;
    return collections || EMPTY_USER_COLLECTIONS;
  }, [session, version]);

  const deviceOwnership = React.useMemo(() => {
    const ownership = session?.deviceOwnership;
    if (ownership) {
      return ownership;
    }
    return createEmptyOwnership();
  }, [session, version]);

  const guestCandidateList = React.useMemo(() => {
    return Array.isArray(session?.guestCandidates) ? session.guestCandidates : [];
  }, [session, version]);

  const zoneProfiles = React.useMemo(() => {
    if (!session) return [];
    const profiles = Array.isArray(session.zoneProfiles)
      ? session.zoneProfiles
      : session.zoneProfileStore?.getProfiles?.() || [];
    return profiles.map((profile) => ({
      ...profile,
      zoneConfig: Array.isArray(profile.zoneConfig)
        ? profile.zoneConfig.map((zone) => ({ ...zone }))
        : [],
      zoneSequence: Array.isArray(profile.zoneSequence)
        ? profile.zoneSequence.map((zone) => ({ ...zone }))
        : [],
      zoneSnapshot: profile.zoneSnapshot
        ? {
            ...profile.zoneSnapshot,
            zoneSequence: Array.isArray(profile.zoneSnapshot.zoneSequence)
              ? profile.zoneSnapshot.zoneSequence.map((zone) => ({ ...zone }))
              : null
          }
        : null
    }));
  }, [session, version]);

  const zoneProfileLookup = React.useMemo(() => {
    const map = new Map();
    zoneProfiles.forEach((profile) => {
      // Use profile ID directly
      const profileId = profile?.id || profile?.profileId;
      if (!profileId) return;
      map.set(profileId, profile);
      // Also index by name for backwards compat
      if (profile.name) {
        map.set(profile.name, profile);
      }
    });
    return map;
  }, [zoneProfiles]);

  const getZoneProfile = React.useCallback((identifier) => {
    if (!identifier) return null;
    // Direct lookup - no slug transformation
    return zoneProfileLookup.get(identifier) || null;
  }, [zoneProfileLookup]);

  const userHeartRateMap = React.useMemo(() => {
    const map = new Map();
    userVitalsMap.forEach((entry, key) => {
      if (!entry) return;
      if (!Number.isFinite(entry.heartRate)) return;
      map.set(key, entry.heartRate);
    });
    return map;
  }, [userVitalsMap]);

  const getUserVitals = React.useCallback((nameOrId) => {
    if (!nameOrId) return null;
    // Try direct lookup by ID first, then by name
    const existing = userVitalsMap.get(nameOrId) || null;
    const normalized = typeof nameOrId === 'string' ? nameOrId.trim().toLowerCase() : '';
    const participant = normalized ? participantLookupByName.get(normalized) : null;

    if (!participant) {
      return existing;
    }

    const participantHeartRate = Number.isFinite(participant.heartRate)
      ? Math.round(participant.heartRate)
      : null;
    const mergedHeartRate = Number.isFinite(participantHeartRate)
      ? participantHeartRate
      : (Number.isFinite(existing?.heartRate) ? existing.heartRate : null);
    const mergedZoneId = existing?.zoneId
      || (participant?.zoneId ? String(participant.zoneId).toLowerCase() : null);
    const mergedZoneColor = existing?.zoneColor || participant?.zoneColor || null;
    const mergedProfileId = existing?.profileId || participant?.profileId || participant?.id || nameOrId;
    const mergedDeviceId = existing?.deviceId || participant?.hrDeviceId || null;
    const mergedSource = existing?.source || (participant?.isGuest ? 'Guest' : null);
    const mergedDisplayLabel = existing?.displayLabel
      || participant?.displayLabel
      || getDisplayLabel(participant?.name || nameOrId, { userId: participant?.id || participant?.profileId });

    if (!existing) {
      return {
        name: participant?.name || name,
        heartRate: mergedHeartRate,
        zoneId: mergedZoneId,
        zoneName: participant?.zoneLabel || null,
        zoneColor: mergedZoneColor,
        targetHeartRate: null,
        rangeMin: null,
        rangeMax: null,
        progress: null,
        showBar: false,
        nextZoneId: null,
        source: mergedSource,
        profileId: mergedProfileId,
        deviceId: mergedDeviceId,
        isGuest: Boolean(participant?.isGuest),
        displayLabel: mergedDisplayLabel
      };
    }

    return {
      ...existing,
      name: existing.name || participant?.name || name,
      heartRate: mergedHeartRate,
      zoneId: mergedZoneId ?? existing.zoneId ?? null,
      zoneColor: mergedZoneColor ?? existing.zoneColor ?? null,
      profileId: mergedProfileId,
      deviceId: mergedDeviceId,
      source: mergedSource ?? existing.source ?? null,
      displayLabel: mergedDisplayLabel
    };
  }, [userVitalsMap, participantLookupByName, getDisplayLabel]);

  const getUserHeartRate = React.useCallback((name) => {
    const vitals = getUserVitals(name);
    if (!vitals) return null;
    return Number.isFinite(vitals.heartRate) ? vitals.heartRate : null;
  }, [getUserVitals]);

  const getEquipmentVibration = React.useCallback((equipmentId) => {
    if (!equipmentId) return null;
    return vibrationState[equipmentId] || null;
  }, [vibrationState]);

  const resolveUserByDevice = React.useCallback((key) => {
    if (key === undefined || key === null) return null;
    const manager = session?.userManager;
    if (!manager) return null;
    if (typeof manager.getUserByDeviceId === 'function') {
      return manager.getUserByDeviceId(key) || null;
    }
    if (typeof manager.resolveUserForDevice === 'function') {
      return manager.resolveUserForDevice(key) || null;
    }
    return null;
  }, [session]);

  const userZoneProgress = React.useMemo(() => {
    const progressMap = new Map();
    const cloneZoneSequence = (sequence) => (Array.isArray(sequence)
      ? sequence.map((zone, index) => ({
          id: zone?.id || null,
          name: zone?.name || null,
          color: zone?.color || null,
          threshold: Number.isFinite(zone?.threshold) ? zone.threshold : null,
          index: Number.isFinite(zone?.index) ? zone.index : index
        }))
      : null);
    userVitalsMap.forEach((entry) => {
      if (!entry?.name) return;
      progressMap.set(entry.name, {
        currentZoneId: entry.zoneId ?? null,
        nextZoneId: entry.nextZoneId ?? null,
        progress: entry.progress ?? null,
        rangeMin: entry.rangeMin ?? null,
        rangeMax: entry.rangeMax ?? null,
        currentHR: entry.heartRate ?? null,
        showBar: entry.showBar ?? false,
        targetHeartRate: entry.targetHeartRate ?? null,
        zoneName: entry.zoneName ?? null,
        zoneColor: entry.zoneColor ?? null,
        zoneSequence: cloneZoneSequence(entry.zoneSequence),
        currentZoneIndex: Number.isFinite(entry.currentZoneIndex) ? entry.currentZoneIndex : null,
        currentZoneThreshold: Number.isFinite(entry.currentZoneThreshold) ? entry.currentZoneThreshold : null,
        nextZoneThreshold: Number.isFinite(entry.nextZoneThreshold) ? entry.nextZoneThreshold : null
      });
    });
    return progressMap;
  }, [userVitalsMap]);

  const userCurrentZones = React.useMemo(() => {
    const map = {};
    userVitalsMap.forEach((vitals) => {
      if (vitals.name && vitals.zoneId) {
        map[vitals.name] = {
          id: vitals.zoneId,
          color: vitals.zoneColor
        };
      }
    });
    return map;
  }, [userVitalsMap]);

  const getUserZoneThreshold = React.useCallback((userName, zoneId) => {
    if (!zoneId) return null;
    const profile = getZoneProfile(userName);
    const zoneConfig = Array.isArray(profile?.zoneConfig) && profile.zoneConfig.length > 0
      ? profile.zoneConfig
      : normalizedBaseZoneConfig;
    return resolveZoneThreshold(zoneConfig, zoneId);
  }, [getZoneProfile, normalizedBaseZoneConfig]);

  const timelineSelectors = React.useMemo(() => {
    const timeline = session?.timeline || null;
    const seriesRef = timeline?.series || {};
    const eventsRef = Array.isArray(timeline?.events) ? timeline.events.slice() : [];
    const timebaseRef = timeline?.timebase || session?.timebase || null;

    const normalizeKind = (raw) => {
      const token = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      if (!token) return null;
      if (token === 'users' || token === 'user') return 'user';
      if (token === 'devices' || token === 'device') return 'device';
      if (token === 'globals' || token === 'global') return 'global';
      if (token === 'entities' || token === 'entity') return 'entity'; // Phase 3
      return token;
    };

    const buildSeriesKey = (descriptor) => {
      if (!descriptor) return null;
      if (typeof descriptor === 'string') {
        const trimmed = descriptor.trim();
        return trimmed || null;
      }
      if (descriptor.key) {
        const trimmed = String(descriptor.key).trim();
        return trimmed || null;
      }
      const normalizedKind = normalizeKind(descriptor.kind);
      const metricToken = descriptor.metric ? String(descriptor.metric).trim().toLowerCase() : null;
      if (!normalizedKind || !metricToken) return null;
      if (normalizedKind === 'global') {
        return `global:${metricToken}`;
      }
      const rawId = descriptor.id ?? descriptor.userId ?? descriptor.entityId ?? descriptor.name ?? null;
      if (rawId == null) return null;
      // Use ID directly for users and entities (they already have canonical IDs)
      // Only normalize for devices which might have special characters
      const normalizedId = (normalizedKind === 'user' || normalizedKind === 'entity')
        ? String(rawId)
        : String(rawId).trim().toLowerCase();
      if (!normalizedId) return null;
      return `${normalizedKind}:${normalizedId}:${metricToken}`;
    };

    const applyWindow = (source = [], options = {}) => {
      const shouldClone = options.clone !== false;
      const baseSeries = shouldClone ? source.slice() : source;
      const windowSizeRaw = Number(options.windowSize);
      if (!Number.isFinite(windowSizeRaw) || windowSizeRaw <= 0) {
        return baseSeries;
      }
      const offsetRaw = Number(options.offset);
      const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
      const end = Math.max(0, baseSeries.length - offset);
      const start = Math.max(0, end - windowSizeRaw);
      return baseSeries.slice(start, end);
    };

    const getSeries = (descriptor, options = {}) => {
      const key = buildSeriesKey(descriptor);
      if (!key) return [];
      const rawSeries = seriesRef[key];
      if (!Array.isArray(rawSeries)) return [];
      return applyWindow(rawSeries, options);
    };

    const getUserSeries = (identifier, metric = 'heart_rate', options = {}) => {
      if (!identifier) return [];
      const key = buildSeriesKey({ kind: 'user', id: identifier, metric });
      if (!key) return [];
      return getSeries(key, options);
    };

    /**
     * Phase 3: Get series for an entity ID
     * @param {string} entityId - Entity ID (e.g., "entity-1735689600000-abc12")
     * @param {string} metric - Metric name (e.g., "heart_rate", "coins_total")
     * @param {Object} [options] - Options for windowing/cloning
     * @returns {Array}
     */
    const getEntitySeries = (entityId, metric = 'heart_rate', options = {}) => {
      if (!entityId) return [];
      const key = buildSeriesKey({ kind: 'entity', entityId, metric });
      if (!key) return [];
      return getSeries(key, options);
    };

    /**
     * Phase 3: Get series for a user OR their active entity (prefers entity if available)
     * This allows chart components to transparently use entity data when available
     * @param {string} identifier - User ID or profile ID
     * @param {string} metric - Metric name
     * @param {Object} [options]
     * @returns {Array}
     */
    const getParticipantSeries = (identifier, metric = 'heart_rate', options = {}) => {
      if (!identifier) return [];
      
      // First check if this identifier IS an entity ID
      if (typeof identifier === 'string' && identifier.startsWith('entity-')) {
        return getEntitySeries(identifier, metric, options);
      }
      
      // Otherwise try to find entity for this user via session
      // Fall back to user series for backward compatibility
      const entityId = session?.userManager?.assignmentLedger?.getEntityIdForUser?.(identifier);
      if (entityId) {
        const entitySeries = getEntitySeries(entityId, metric, options);
        if (entitySeries.length > 0) return entitySeries;
      }
      
      // Fall back to user series
      return getUserSeries(identifier, metric, options);
    };

    const getLatestValue = (descriptor) => {
      const key = buildSeriesKey(descriptor);
      if (!key) return null;
      const rawSeries = seriesRef[key];
      if (!Array.isArray(rawSeries) || rawSeries.length === 0) return null;
      for (let index = rawSeries.length - 1; index >= 0; index -= 1) {
        const value = rawSeries[index];
        if (value !== undefined && value !== null) {
          return value;
        }
      }
      return null;
    };

    return {
      timebase: timebaseRef,
      events: eventsRef,
      getSeries,
      getUserSeries,
      getEntitySeries, // Phase 3
      getParticipantSeries, // Phase 3
      getLatestValue,
      getSeriesKey: buildSeriesKey,
      seriesKeys: Object.keys(seriesRef)
    };
  }, [session, version]);

  // The session already owns the roster; avoid writing it back every render to prevent update loops.

  useEffect(() => {
    if (!voiceMemoOverlayState.open) return;
    if (voiceMemoOverlayState.mode === 'list' && voiceMemos.length === 0) {
      logVoiceMemo('overlay-auto-close', { reason: 'no-memos', mode: voiceMemoOverlayState.mode });
      setVoiceMemoOverlayState(VOICE_MEMO_OVERLAY_INITIAL);
      return;
    }
    if (voiceMemoOverlayState.memoId) {
      const exists = voiceMemos.some((memo) => memo && String(memo.memoId) === String(voiceMemoOverlayState.memoId));
      if (!exists && voiceMemoOverlayState.mode !== 'redo') {
        logVoiceMemo('overlay-clear-memo', {
          reason: 'memo-missing',
          memoId: voiceMemoOverlayState.memoId,
          mode: voiceMemoOverlayState.mode
        }, { level: 'warn' });
        setVoiceMemoOverlayState((prev) => ({ ...prev, memoId: null }));
      }
    }
  }, [logVoiceMemo, voiceMemoOverlayState, voiceMemos, setVoiceMemoOverlayState]);

  useEffect(() => {
    const session = fitnessSessionRef.current;
    if (!session || typeof session.updateSnapshot !== 'function') return;
    try {
      session.updateSnapshot({
        users,
        devices: fitnessDevices,
        playQueue: fitnessPlayQueue,
        participantRoster,
        zoneConfig
      });
    } catch (error) {
      if (FITNESS_DEBUG) {
        logFitnessContext('snapshot-error', { error: error?.message || String(error) }, { level: 'warn' });
      }
    }
  }, [users, fitnessDevices, fitnessPlayQueue, participantRoster, zoneConfig]);

  // Legacy governance logic removed (delegated to GovernanceEngine)

  // Governance State from Engine
  const governanceState = session?.governanceEngine?.state || { status: 'idle' };
  const governanceChallenge = session?.governanceEngine?.challengeState || {};
  const treasureBox = session?.treasureBox ? session.treasureBox.summary : null;

  // TreasureBox instance and helpers for chart live edge and responsive UI
  const treasureBoxInstance = session?.treasureBox || null;
  const getTreasureBoxLiveSnapshot = React.useCallback(() => {
    return session?.treasureBox?.getLiveSnapshot?.() || [];
  }, [session]);
  const getTreasureBoxIntervalProgress = React.useCallback((userId) => {
    return session?.treasureBox?.getIntervalProgress?.(userId) || null;
  }, [session]);

  const triggerChallengeNow = React.useCallback((payload) => {
      return session?.governanceEngine?.triggerChallenge(payload);
  }, [session]);

  const value = {
    fitnessConfiguration,
    usersConfig,
    zoneConfig,
    equipmentConfig,
    coinTimeUnitMs,
    governanceConfig,
    governedLabels,
    governedLabelSet,
    governedTypes,
    governedTypeSet,
    
    connected,
    vibrationState,
    fitnessDevices,
    // Expose allDevices for backward compatibility (prefer domain selectors below)
    allDevices,
    heartRateDevices,
    // Phase 2 SSOT: Domain-level device selectors
    rpmDevices,
    equipmentDevices,
    users,
    deviceAssignments,
    zoneProfiles,
    getZoneProfile,
    userCollections,
    deviceOwnership,
    guestCandidates: guestCandidateList,
    
    toggleSidebarSizeMode,
    sidebarSizeMode,
    sidebarCollapsed,
    setSidebarCollapsed,
    collapseSidebar,
    expandSidebar,
    toggleSidebarCollapsed,
    voiceMemoOverlayState,
    
    // Voice memo video pause/resume control (BUG-08 fix)
    videoPlayerPaused,
    setVideoPlayerPaused,
    
    registerVideoPlayer,
    videoPlayerRef,
    
    forceUpdate,
    assignGuestToDevice,
    clearGuestAssignment,
    suppressDeviceUntilNextReading,
    reconnectFitnessWebSocket,
    resetAllUserSessions: () => session?.userManager?.resetAllSessions(),
    
    voiceMemos,
    addVoiceMemoToSession,
    removeVoiceMemoFromSession,
    replaceVoiceMemoInSession,
    closeVoiceMemoOverlay,
    openVoiceMemoReview,
    openVoiceMemoList,
    openVoiceMemoCapture,
    
    setGovernanceMedia,
    updateGovernancePhase,
    governanceState,
    governanceChallenge,
    activeGovernancePolicy: session?.governanceEngine?.activePolicy,
    triggerChallengeNow,
    
    treasureBox,
    treasureBoxInstance,
    getTreasureBoxLiveSnapshot,
    getTreasureBoxIntervalProgress,
    timelineTimebase: timelineSelectors.timebase,
    timelineEvents: timelineSelectors.events,
    getTimelineSeries: timelineSelectors.getSeries,
    getUserTimelineSeries: timelineSelectors.getUserSeries,
    getEntityTimelineSeries: timelineSelectors.getEntitySeries, // Phase 3
    getParticipantTimelineSeries: timelineSelectors.getParticipantSeries, // Phase 3
    getTimelineLatestValue: timelineSelectors.getLatestValue,
    getTimelineSeriesKey: timelineSelectors.getSeriesKey,
    timelineSeriesKeys: timelineSelectors.seriesKeys,
    
    // Transfer version - triggers re-render when users are transferred (grace period substitution)
    transferVersion,
    
    // Phase 3: Entity registry access
    entityRegistry: session?.entityRegistry,
    getEntitiesForProfile: session?.getEntitiesForProfile?.bind(session),
    getProfileCoinsTotal: session?.getProfileCoinsTotal?.bind(session),
    getProfileTimelineSeries: session?.getProfileTimelineSeries?.bind(session),
    
    // Activity Monitor - single source of truth for participant status (Phase 2)
    activityMonitor: session?.activityMonitor,
    
    // Ambient LED sync status
    ambientLedEnabled,
    
    getDisplayLabel,
    zoneRankMap,
    colorToZoneId,
    zoneInfoMap,
    guestAssignmentService: guestAssignmentServiceRef.current,
    
    getDeviceUser: resolveUserByDevice,
    getDeviceAssignment,
    
    // App State & Methods
    activeApp,
    overlayApp,
    launchApp,
    closeApp,
    launchOverlayApp,
    dismissOverlayApp,

    currentMedia,
    setCurrentMedia,
    recentlyPlayed,
    trackRecentlyPlayed,
    emitAppEvent,
    subscribeToAppEvent,
    reportGovernanceMetric,

    // Legacy / Compatibility
    fitnessSession: session?.summary,
    fitnessSessionInstance: session,
    isSessionActive: session?.isActive,
    fitnessPlayQueue,
    setFitnessPlayQueue,
    registerSessionScreenshot: (capture) => session?.recordScreenshotCapture?.(capture),
    configureSessionScreenshotPlan: (plan) => session?.setScreenshotPlan?.(plan),
    preferredMicrophoneId,
    setPreferredMicrophoneId,
    userCount: users.size,
    usersConfigRaw: usersConfig,
    participantRoster,
    // Phase 1 SSOT: Canonical participant list - USE THIS instead of filtering devices
    activeHeartRateParticipants,
    participantsByDevice: participantLookupByDevice,
    participantsByName: participantLookupByName,
    userVitals: userVitalsMap,
    getUserVitals,
    userZoneProgress,
    getUserZoneThreshold,
    userHeartRates: new Map(), // TODO
    getUserHeartRate,
    getEquipmentVibration,
    replacedPrimaryPool,
    primaryUsers: [],
    secondaryUsers: [],
    deviceConfiguration: ant_devices,
    equipment: equipmentConfig,
    hrColorMap: {},
    plexConfig,
    nomusicLabels,
    musicEnabled,
    setMusicAutoEnabled,
    setMusicOverride: setMusicOverrideState,
    selectedPlaylistId,
    setSelectedPlaylistId,
    governance: governanceState.status,
    zones: zoneConfig || [],
    userCurrentZones,
    heartRate: heartRateDevices[0] || null,
    getUserByName: (nameOrId) => {
      if (!nameOrId) return null;
      // Direct lookup by ID
      if (users.has(nameOrId)) return users.get(nameOrId);
      
      // Fallback: search by name (case-insensitive)
      const lowerName = String(nameOrId).toLowerCase();
      for (const user of users.values()) {
        if (user.name?.toLowerCase() === lowerName || user.id === lowerName) {
          return user;
        }
      }
      return null;
    },
    getUserByDevice: resolveUserByDevice
  };

  return (
    <FitnessContext.Provider value={value}>
      {children}
    </FitnessContext.Provider>
  );
};