import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  User,
  DeviceFactory,
  setFitnessTimeouts,
  getFitnessTimeouts,
  FitnessSession,
  buildZoneConfig,
  deriveZoneProgressSnapshot,
  resolveZoneThreshold,
  resolveDisplayLabel
} from '../hooks/useFitnessSession.js';

// Create context
const FitnessContext = createContext(null);

const normalizeLabelList = (raw) => {
  if (!Array.isArray(raw)) return [];
  const normalized = raw
    .map(label => (typeof label === 'string' ? label.trim().toLowerCase() : ''))
    .filter(Boolean);
  return Array.from(new Set(normalized));
};

const VOICE_MEMO_OVERLAY_INITIAL = {
  open: false,
  mode: null,
  memoId: null,
  autoAccept: false,
  startedAt: null
};

export const slugifyId = (value, fallback = 'user') => {
  if (!value) return fallback;
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
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
  const FITNESS_DEBUG = false; // set false to silence diagnostic logs
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
  const [musicAutoEnabledState, setMusicAutoEnabledState] = useState(false);
  const [musicOverride, setMusicOverride] = useState(null);
  const [lastPlaylistId, setLastPlaylistId] = useState(null);
  const [videoPlayerPaused, setVideoPlayerPaused] = useState(false);
  // Accept either shape: { fitness: {...} } or flattened keys directly
  const fitnessRoot = fitnessConfiguration?.fitness ? fitnessConfiguration.fitness : fitnessConfiguration?.plex ? fitnessConfiguration : (fitnessConfiguration || {});
  if (FITNESS_DEBUG) {
    try {
      console.log('[FitnessContext][PROP] top-level keys:', Object.keys(fitnessConfiguration||{}));
      console.log('[FitnessContext][PROP] resolved fitnessRoot keys:', Object.keys(fitnessRoot||{}));
    } catch(_) {}
  }
  const plexConfig = fitnessRoot?.plex || {};
  const musicPlaylists = Array.isArray(plexConfig.music_playlists) ? plexConfig.music_playlists : [];
  const nomusicLabelsRaw = Array.isArray(plexConfig.nomusic_labels) ? plexConfig.nomusic_labels : [];
  const normalizedNomusicLabels = React.useMemo(() => normalizeLabelList(nomusicLabelsRaw), [nomusicLabelsRaw]);
  const ant_devices = fitnessRoot?.ant_devices || {};
  let usersConfig = fitnessRoot?.users || {};
  if (FITNESS_DEBUG && (!usersConfig.primary || usersConfig.primary.length === 0)) {
    console.warn('[FitnessContext][WARN] usersConfig.primary empty (resolved).');
  }

  const [guestAssignments, setGuestAssignments] = useState({});
  const guestAssignmentsRef = useRef(guestAssignments);
  
  // Create effective runtime config that includes active guests merged into primary pool
  const effectiveUsersConfig = React.useMemo(() => {
    const base = {
      primary: Array.isArray(usersConfig.primary) ? [...usersConfig.primary] : [],
      secondary: Array.isArray(usersConfig.secondary) ? [...usersConfig.secondary] : [],
      family: usersConfig.family || [],
      friends: usersConfig.friends || []
    };
    
    // Merge active guest configs into primary pool for zone threshold resolution
    const guestPool = [...(usersConfig.family || []), ...(usersConfig.friends || [])];
    Object.values(guestAssignments).forEach(assignment => {
      if (!assignment?.name) return;
      const guestConfig = guestPool.find(u => 
        u.name === assignment.name || 
        u.id === assignment.candidateId || 
        u.id === assignment.profileId
      );
      if (guestConfig && !base.primary.find(u => u.name === guestConfig.name)) {
        base.primary.push({ ...guestConfig });
        if (FITNESS_DEBUG) {
          console.log('[FitnessContext][CONFIG] Merged guest into effectiveUsersConfig:', guestConfig.name);
        }
      }
    });
    
    return base;
  }, [usersConfig, guestAssignments]);

  const userGroupLabelMap = React.useMemo(() => {
    const map = new Map();
    const add = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach((entry) => {
        if (!entry?.name || !entry.group_label) return;
        map.set(slugifyId(entry.name), entry.group_label);
      });
    };
    add(effectiveUsersConfig?.primary);
    add(effectiveUsersConfig?.secondary);
    add(effectiveUsersConfig?.family);
    add(effectiveUsersConfig?.friends);
    return map;
  }, [effectiveUsersConfig]);
  
  const equipmentConfig = fitnessRoot?.equipment || [];
  const coinTimeUnitMs = fitnessRoot?.coin_time_unit_ms;
  const zoneConfig = fitnessRoot?.zones;
  const normalizedBaseZoneConfig = React.useMemo(() => buildZoneConfig(zoneConfig), [zoneConfig]);
  const governanceConfig = fitnessRoot?.governance || {};
  const rawGovernedLabels = plexConfig?.governed_labels;
  const governedLabels = Array.isArray(rawGovernedLabels)
    ? rawGovernedLabels.filter(label => typeof label === 'string')
    : [];
  const primaryConfigByName = React.useMemo(() => {
    const map = new Map();
    const source = Array.isArray(usersConfig?.primary) ? usersConfig.primary : [];
    source.forEach((cfg) => {
      if (cfg?.name) {
        map.set(cfg.name, cfg);
      }
    });
    return map;
  }, [usersConfig?.primary]);

  const [connected, setConnected] = useState(false);
  const [latestData, setLatestData] = useState(null);
  const [fitnessDevices, setFitnessDevices] = useState(new Map());
  const [users, setUsers] = useState(new Map());
  const usersRef = useRef(users);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [internalPlayQueue, setInternalPlayQueue] = useState([]);
  const [governancePhase, setGovernancePhase] = useState(null); // null | 'init' | 'green' | 'yellow' | 'red'
  const [governanceMedia, setGovernanceMediaState] = useState(null);
  const [governancePulse, setGovernancePulse] = useState(0);
  const [preferredMicrophoneId, setPreferredMicrophoneId] = useState('');
  const [voiceMemoOverlayState, setVoiceMemoOverlayState] = useState(VOICE_MEMO_OVERLAY_INITIAL);
  const [voiceMemoVersion, setVoiceMemoVersion] = useState(0);
  const hrDeviceUserMapRef = useRef(new Map());
  const suppressedDevicesRef = useRef(new Set());
  const governanceMetaRef = useRef({ mediaId: null, satisfiedOnce: false, deadline: null });
  const governanceTimerRef = useRef(null);
  const governanceRequirementSummaryRef = useRef({ policyId: null, targetUserCount: null, requirements: [], activeCount: 0 });
  const governanceChallengeRef = useRef({
    activePolicyId: null,
    activePolicyName: null,
    videoLocked: false,
    nextChallengeAt: null,
    nextChallengeRemainingMs: null,
    nextChallenge: null,
    activeChallenge: null,
    challengeHistory: [],
    forceStartRequest: null,
    selectionCursor: {},
    selectionRandomBag: {}
  });
  const governanceChallengeTimerRef = useRef(null);
  const [, forceVersion] = useState(0); // used to force re-render on treasure box coin mutation
  const scheduledUpdateRef = useRef(false); // debounce for mutation callback
  const fitnessSessionRef = useRef(new FitnessSession());
  const userZoneConfigCacheRef = useRef(new Map());

  // Sidebar size mode: 'regular' | 'large'
  const [sidebarSizeMode, setSidebarSizeMode] = useState('regular');
  const toggleSidebarSizeMode = React.useCallback(() => {
    setSidebarSizeMode((m) => (m === 'regular' ? 'large' : 'regular'));
  }, []);
  const [mediaSwapActive, setMediaSwapActive] = useState(false);
  const toggleMediaSwap = React.useCallback(() => {
    setMediaSwapActive((prev) => !prev);
  }, []);

  const assignGuestToDevice = React.useCallback((deviceId, assignment) => {
    if (deviceId == null) return;
    const key = String(deviceId);
    
    // Pre-flight: capture current base user name before state update
    let capturedBaseUserName = null;
    const prevAssignment = guestAssignmentsRef.current?.[key];
    if (prevAssignment?.baseUserName) {
      capturedBaseUserName = prevAssignment.baseUserName;
    } else {
      const knownUser = hrDeviceUserMapRef.current.get(key);
      if (knownUser?.name) {
        capturedBaseUserName = knownUser.name;
      } else {
        usersRef.current.forEach((user) => {
          if (!capturedBaseUserName && String(user?.hrDeviceId) === key) {
            capturedBaseUserName = user.name;
          }
        });
      }
    }
    
    setGuestAssignments(prev => {
      if (!assignment) {
        // Clearing assignment: rename guest back to base user in TreasureBox
        if (prev[key] && capturedBaseUserName && prev[key].name !== capturedBaseUserName) {
          try {
            fitnessSessionRef.current?.treasureBox?.renameUser(prev[key].name, capturedBaseUserName);
            if (FITNESS_DEBUG) {
              console.log('[FitnessContext][GUEST] Cleared guest assignment, renamed TB user:', prev[key].name, '→', capturedBaseUserName);
            }
          } catch (err) {
            console.warn('[FitnessContext][GUEST] Failed to rename TB user on clear:', err);
          }
        }
        if (!prev[key]) return prev;
        const { [key]: _removed, ...rest } = rest;
        // Force re-evaluation after clearing
        setTimeout(() => forceVersion(v => v + 1), 0);
        return rest;
      }
      
      const normalizedName = assignment.name || 'Guest';
      const profileId = assignment.profileId || assignment.candidateId || slugifyId(normalizedName);
      let baseUserName = assignment.baseUserName ?? capturedBaseUserName ?? null;
      
      // Immediately update TreasureBox to use new guest name (atomic swap)
      if (baseUserName && normalizedName !== baseUserName) {
        try {
          const renamed = fitnessSessionRef.current?.treasureBox?.renameUser(baseUserName, normalizedName);
          if (FITNESS_DEBUG) {
            console.log('[FitnessContext][GUEST] Assigned guest, renamed TB user:', baseUserName, '→', normalizedName, 'success:', renamed);
          }
        } catch (err) {
          console.warn('[FitnessContext][GUEST] Failed to rename TB user:', err);
        }
      }
      
      const newAssignment = {
        ...assignment,
        name: normalizedName,
        profileId,
        candidateId: assignment.candidateId || assignment.id || profileId,
        source: assignment.source || assignment.category || null,
        baseUserName: baseUserName || null,
        assignedAt: Date.now()
      };
      
      // Force immediate re-evaluation of derived state (roster, zones, governance)
      setTimeout(() => forceVersion(v => v + 1), 0);
      
      return {
        ...prev,
        [key]: newAssignment
      };
    });
  }, []);

  const clearGuestAssignment = React.useCallback((deviceId) => {
    if (deviceId == null) return;
    assignGuestToDevice(deviceId, null);
  }, [assignGuestToDevice]);

  const suppressDeviceUntilNextReading = React.useCallback((deviceId) => {
    if (deviceId == null) return;
    const key = String(deviceId);
    suppressedDevicesRef.current.add(key);
    setFitnessDevices((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      try {
        fitnessSessionRef.current?.updateActiveDevices?.(next);
      } catch (error) {
        if (FITNESS_DEBUG) {
          console.warn('[FitnessContext] Failed to update active devices after manual removal', error);
        }
      }
      return next;
    });
  }, []);

  const voiceMemos = React.useMemo(() => {
    const raw = fitnessSessionRef.current?.voiceMemos;
    if (!Array.isArray(raw)) return [];
    return raw.map((memo) => ({ ...memo }));
  }, [voiceMemoVersion, lastUpdate]);

  const addVoiceMemoToSession = React.useCallback((memo) => {
    if (!memo) return null;
    let stored = memo;
    try {
      stored = fitnessSessionRef.current?.addVoiceMemo?.(memo) || memo;
    } catch (error) {
      console.warn('[FitnessContext] addVoiceMemoToSession failed', error);
    }
    setVoiceMemoVersion((version) => version + 1);
    return stored;
  }, []);

  const removeVoiceMemoFromSession = React.useCallback((memoId) => {
    if (!memoId) return null;
    let removed = null;
    try {
      removed = fitnessSessionRef.current?.removeVoiceMemo?.(memoId) || null;
    } catch (error) {
      console.warn('[FitnessContext] removeVoiceMemoFromSession failed', error);
    }
    if (removed) {
      setVoiceMemoVersion((version) => version + 1);
    }
    return removed;
  }, []);

  const replaceVoiceMemoInSession = React.useCallback((memoId, memo) => {
    if (!memoId || !memo) return null;
    let stored = null;
    try {
      stored = fitnessSessionRef.current?.replaceVoiceMemo?.(memoId, memo) || null;
    } catch (error) {
      console.warn('[FitnessContext] replaceVoiceMemoInSession failed', error);
    }
    if (stored) {
      setVoiceMemoVersion((version) => version + 1);
    }
    return stored;
  }, []);

  const closeVoiceMemoOverlay = React.useCallback(() => {
    setVoiceMemoOverlayState(VOICE_MEMO_OVERLAY_INITIAL);
  }, []);

  const openVoiceMemoReview = React.useCallback((memoOrId, { autoAccept = false } = {}) => {
    const id = typeof memoOrId === 'string' ? memoOrId : memoOrId?.memoId;
    if (!id) return;
    setVoiceMemoOverlayState({
      open: true,
      mode: 'review',
      memoId: id,
      autoAccept,
      startedAt: Date.now()
    });
  }, []);

  const openVoiceMemoList = React.useCallback(() => {
    setVoiceMemoOverlayState({
      open: true,
      mode: 'list',
      memoId: null,
      autoAccept: false,
      startedAt: Date.now()
    });
  }, []);

  const openVoiceMemoRedo = React.useCallback((memoOrId) => {
    const id = typeof memoOrId === 'string' ? memoOrId : memoOrId?.memoId;
    if (!id) return;
    setVoiceMemoOverlayState({
      open: true,
      mode: 'redo',
      memoId: id,
      autoAccept: false,
      startedAt: Date.now()
    });
  }, []);

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

  // Lightweight heartbeat to refresh UI (zones, elapsed) without per-sample churn
  useEffect(() => {
    const interval = setInterval(() => {
      forceVersion(v => v + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  
  // Use the provided queue state from props if available, otherwise use internal state
  const fitnessPlayQueue = propPlayQueue !== undefined ? propPlayQueue : internalPlayQueue;
  const setFitnessPlayQueue = propSetPlayQueue || setInternalPlayQueue;
  const setGovernanceMedia = React.useCallback((input) => {
    setGovernanceMediaState((prev) => {
      if (!input || !input.id) {
        return prev === null ? prev : null;
      }
      const next = {
        id: input.id,
        labels: normalizeLabelList(input.labels)
      };
      if (prev && prev.id === next.id) {
        if (prev.labels.length === next.labels.length && prev.labels.every((label, index) => label === next.labels[index])) {
          return prev;
        }
      }
      return next;
    });
  }, []);
  const updateGovernancePhase = React.useCallback((nextPhase) => {
    setGovernancePhase((prev) => (prev === nextPhase ? prev : nextPhase));
  }, []);

  useEffect(() => {
    const meta = governanceMetaRef.current;
    const mediaId = governanceMedia?.id ?? null;
    if (meta.mediaId !== mediaId) {
      if (governanceTimerRef.current) {
        clearTimeout(governanceTimerRef.current);
        governanceTimerRef.current = null;
      }
      if (governanceChallengeTimerRef.current) {
        clearTimeout(governanceChallengeTimerRef.current);
        governanceChallengeTimerRef.current = null;
      }
      governanceChallengeRef.current = {
        activePolicyId: null,
        activePolicyName: null,
        videoLocked: false,
        nextChallengeAt: null,
        nextChallengeRemainingMs: null,
        nextChallenge: null,
        activeChallenge: null,
        challengeHistory: [],
        forceStartRequest: null,
        selectionCursor: {},
        selectionRandomBag: {}
      };
      governanceMetaRef.current = { mediaId, satisfiedOnce: false, deadline: null };
      updateGovernancePhase(null);
    }
  }, [governanceMedia?.id, updateGovernancePhase]);

  useEffect(() => () => {
    if (governanceTimerRef.current) {
      clearTimeout(governanceTimerRef.current);
      governanceTimerRef.current = null;
    }
    if (governanceChallengeTimerRef.current) {
      clearTimeout(governanceChallengeTimerRef.current);
      governanceChallengeTimerRef.current = null;
    }
  }, []);
  
  
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000;
  
  // Use ref for device updates to prevent state management issues
  const deviceUpdateRef = useRef(null);
  // Keep a ref mirror of users map to avoid stale closures inside ws handlers
  useEffect(() => { usersRef.current = users; }, [users]);
  useEffect(() => { guestAssignmentsRef.current = guestAssignments; }, [guestAssignments]);
  useEffect(() => {
    userZoneConfigCacheRef.current = new Map();
  }, [zoneConfig, effectiveUsersConfig]);
  useEffect(() => {
    if (FITNESS_DEBUG) {
      console.log('[FitnessContext][USERS_REF] Updated usersRef size=', usersRef.current.size);
      usersRef.current.forEach(u => console.log('[FitnessContext][USERS_REF] user', { name: u.name, hr: u.hrDeviceId, cadence: u.cadenceDeviceId, id: u.id }));
    }
  }, [users]);
  // Fast lookup map (hr device id -> user object)
  useEffect(() => {
    const map = new Map();
    users.forEach(u => {
      if (u?.hrDeviceId !== undefined && u?.hrDeviceId !== null) {
        map.set(String(u.hrDeviceId), u);
      }
    });
    hrDeviceUserMapRef.current = map;
    if (FITNESS_DEBUG) {
      console.log('[FitnessContext][HR_LOOKUP] Rebuilt. Keys=', Array.from(map.keys()));
    }
  }, [users]);

  // Initialize / refresh users when configuration becomes available or changes
  useEffect(() => {
    if (!usersConfig || ( !usersConfig.primary && !usersConfig.secondary)) {
      if (FITNESS_DEBUG) console.log('[FitnessContext][INIT] usersConfig not ready yet');
      return;
    }
    // Build a new set of names to detect if we already initialized with identical config
    const incomingNames = new Set([...(usersConfig.primary||[]).map(u=>u.name), ...(usersConfig.secondary||[]).map(u=>u.name)]);
    const existingNames = new Set(Array.from(usersRef.current.keys()));
    let identical = incomingNames.size === existingNames.size;
    if (identical) {
      for (const n of incomingNames) { if (!existingNames.has(n)) { identical = false; break; } }
    }
    if (identical && usersRef.current.size > 0) {
      if (FITNESS_DEBUG) console.log('[FitnessContext][INIT] Skipping rebuild; user set unchanged');
      return; // no rebuild needed
    }

    const userMap = new Map();
    if (usersConfig.primary) {
      usersConfig.primary.forEach(userConfig => {
        const user = new User(
          userConfig.name,
          userConfig.birthyear,
          userConfig.hr,
          userConfig.cadence,
          { globalZones: zoneConfig, zoneOverrides: userConfig.zones }
        );
        if (userConfig.id) user.id = userConfig.id;
        userMap.set(userConfig.name, user);
      });
    }
    if (usersConfig.secondary) {
      usersConfig.secondary.forEach(userConfig => {
        const user = new User(
          userConfig.name,
          userConfig.birthyear,
          userConfig.hr,
          userConfig.cadence,
          { globalZones: zoneConfig, zoneOverrides: userConfig.zones }
        );
        if (userConfig.id) user.id = userConfig.id;
        userMap.set(userConfig.name, user);
      });
    }
    if (FITNESS_DEBUG) {
      console.log('[FitnessContext][INIT] Users (re)built from config');
      console.table(Array.from(userMap.values()).map(u => ({ name: u.name, hr: u.hrDeviceId, cadence: u.cadenceDeviceId, id: u.id })));
    }
    setUsers(userMap);
  }, [usersConfig, zoneConfig]);

  // Function to create WebSocket connection
  const connectWebSocket = () => {
    if (wsRef.current?.readyState === WebSocket.CONNECTING) {
      console.log('Fitness WebSocket connection already in progress');
      return;
    }

    const isLocalhost = /localhost/.test(window.location.href);
    const baseUrl = isLocalhost ? 'http://localhost:3112' : window.location.origin;
    const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';
    
    console.log(`Fitness WebSocket connecting to: ${wsUrl}`);
    
    const ws = new window.WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Only process fitness messages
        if (data.topic === 'fitness') {
          setLatestData(data);
          setLastUpdate(new Date());
          
          // Process ANT+ device data
          if (data.type === 'ant' && data.deviceId && data.data) {
            const deviceId = String(data.deviceId);
            const rawProfile = data.profile || '';
            suppressedDevicesRef.current.delete(deviceId);
            // Normalize profile to match DeviceFactory expectations
            const upper = String(rawProfile).toUpperCase();
            let profile;
            switch (upper) {
              case 'HR':
              case 'HEART':
              case 'HEARTRATE':
              case 'HEART_RATE':
                profile = 'HR'; break;
              case 'SPEED':
              case 'SPD':
                profile = 'Speed'; break;
              case 'CAD':
              case 'CADENCE':
                profile = 'CAD'; break;
              case 'POWER':
              case 'PWR':
                profile = 'Power'; break;
              default:
                profile = rawProfile; // let factory fall back to UnknownDevice
            }
            const rawData = data.data;
            if (FITNESS_DEBUG) {
              console.log('[FitnessContext][WS] Incoming ANT', { deviceId, rawProfile, normalizedProfile: profile, dataKeys: Object.keys(rawData||{}) });
            }
            
            setFitnessDevices(prevDevices => {
              const newDevices = new Map(prevDevices);
              let device = newDevices.get(deviceId);

              if (device) {
                // Guard against prototype loss (e.g. earlier code replaced class instance with plain object)
                if (typeof device.updateData !== 'function') {
                  // Reconstruct correct device instance preserving lastSeen if possible
                  const reconstructed = DeviceFactory.createDevice(deviceId, profile, { ...rawData, dongleIndex: data.dongleIndex, timestamp: data.timestamp });
                  // Attempt to copy a few runtime fields from stale object
                  if (device.lastSeen) reconstructed.lastSeen = device.lastSeen;
                  if (device.isActive === false) reconstructed.isActive = false;
                  device = reconstructed;
                } else {
                  device.updateData({ ...rawData, dongleIndex: data.dongleIndex, timestamp: data.timestamp });
                }
              } else {
                device = DeviceFactory.createDevice(deviceId, profile, { ...rawData, dongleIndex: data.dongleIndex, timestamp: data.timestamp });
              }

              // Store reference (no cloning so we keep prototype); downstream only reads scalar fields
              deviceUpdateRef.current = {
                deviceId,
                device
              };
              
              newDevices.set(deviceId, device);
              // Record session activity
              try {
                fitnessSessionRef.current.recordDeviceActivity(device);
              } catch (e) {
                console.warn('FitnessSession record error', e);
              }
              // If a treasure box was just created by recordDeviceActivity (first activity), configure it immediately
              try {
                const tb = fitnessSessionRef.current.treasureBox;
                if (tb && tb.globalZones && tb.globalZones.length === 0) {
                  tb.configure({
                    coinTimeUnitMs,
                    zones: zoneConfig,
                    users: usersConfig
                  });
                  // Register mutation callback once
                  tb.setMutationCallback(() => {
                    if (scheduledUpdateRef.current) return;
                    scheduledUpdateRef.current = true;
                    requestAnimationFrame(() => {
                      forceVersion(v => v + 1);
                      scheduledUpdateRef.current = false;
                    });
                  });
                }
              } catch (e) {
                console.warn('TreasureBox immediate configure failed', e);
              }
              // If this is a heart rate device, attempt to map to user and record heart rate for treasure box
              try {
                if (device.type === 'heart_rate' && fitnessSessionRef.current.treasureBox) {
                  const deviceIdStr = String(device.deviceId);
                  const guestBinding = guestAssignmentsRef.current?.[deviceIdStr];
                  if (guestBinding && guestBinding.name) {
                    fitnessSessionRef.current.treasureBox.recordUserHeartRate(guestBinding.name, device.heartRate);
                    if (FITNESS_DEBUG) {
                      console.log('[FitnessContext][WS] HR scan mapping (guest)', { deviceId: deviceIdStr, guest: guestBinding.name, hr: device.heartRate });
                    }
                  } else {
                    const matches = [];
                    usersRef.current.forEach((userObj) => {
                      if (String(userObj.hrDeviceId) === deviceIdStr) {
                        matches.push(userObj.name);
                        fitnessSessionRef.current.treasureBox.recordUserHeartRate(userObj.name, device.heartRate);
                      }
                    });
                    if (FITNESS_DEBUG) {
                      console.log('[FitnessContext][WS] HR scan mapping', { deviceId: deviceIdStr, matches, hr: device.heartRate });
                    }
                  }
                }
              } catch (e) {
                console.warn('TreasureBox HR record error', e);
              }
              return newDevices;
            });
            
            // Update users in a separate effect to avoid nested state updates
            if (deviceUpdateRef.current) {
              const { deviceId, device } = deviceUpdateRef.current;
              
              setUsers(prevUsers => {
                // Use ref for iteration to ensure latest map
                const refUsers = usersRef.current;
                let mutated = false;
                refUsers.forEach((user, userName) => {
                  if (String(user.hrDeviceId) === deviceId || String(user.cadenceDeviceId) === deviceId) {
                    user.updateFromDevice(device);
                    mutated = true;
                  }
                });
                if (!mutated) return prevUsers; // no changes
                // Return a new Map reference so React notices update
                const cloned = new Map(refUsers);
                return cloned;
              });
              
              deviceUpdateRef.current = null;
            }
            // Attempt heart rate -> user treasure coin mapping via quick lookup ref (redundant safeguard)
            if (device.type === 'heart_rate' && fitnessSessionRef.current.treasureBox) {
              const guestBinding = guestAssignmentsRef.current?.[deviceId];
              if (guestBinding && guestBinding.name) {
                if (FITNESS_DEBUG) {
                  console.log('[FitnessContext][WS] HR quick lookup (guest)', { deviceId, guest: guestBinding.name, hr: device.heartRate });
                }
                try {
                  fitnessSessionRef.current.treasureBox.recordUserHeartRate(guestBinding.name, device.heartRate);
                } catch (e) { /* ignore */ }
              } else {
                const matchedUser = hrDeviceUserMapRef.current.get(deviceId);
                if (FITNESS_DEBUG) {
                  console.log('[FitnessContext][WS] HR quick lookup', { deviceId, found: !!matchedUser, user: matchedUser?.name, hr: device.heartRate });
                }
                if (matchedUser) {
                  try {
                    fitnessSessionRef.current.treasureBox.recordUserHeartRate(matchedUser.name, device.heartRate);
                  } catch (e) { /* ignore */ }
                }
              }
            }
          }
        }
      } catch (e) {
        // ignore non-JSON or irrelevant messages
     //   console.debug('Fitness WebSocket: Non-JSON message received');
      }
    };

    ws.onclose = (event) => {
   //   console.log('Fitness WebSocket disconnected:', event.code, event.reason);
      setConnected(false);
      wsRef.current = null;
      
      // Attempt to reconnect
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current), 30000);
        console.log(`Fitness WebSocket reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          connectWebSocket();
        }, delay);
      } else {
        console.log('Fitness WebSocket: Max reconnection attempts reached');
      }
    };

    ws.onerror = (err) => {
      console.error('Fitness WebSocket error:', err);
      setConnected(false);
    };
  };

  // Apply configuration-based timeouts when configuration changes
  useEffect(() => {
    const inactive = ant_devices?.timeout?.inactive;
    const remove = ant_devices?.timeout?.remove;
    setFitnessTimeouts({ inactive, remove });
  }, [ant_devices?.timeout?.inactive, ant_devices?.timeout?.remove]);

  // Configure treasure box when session first starts OR when zone configuration changes
  useEffect(() => {
    if (fitnessSessionRef.current && fitnessSessionRef.current.treasureBox) {
      fitnessSessionRef.current.treasureBox.configure({
        coinTimeUnitMs,
        zones: zoneConfig,
        users: effectiveUsersConfig
      });
      if (FITNESS_DEBUG) {
        console.log('[FitnessContext][TB] Configured with effectiveUsersConfig, primary count:', effectiveUsersConfig.primary.length);
      }
      // Guarantee callback registered (idempotent)
      try { 
        fitnessSessionRef.current.treasureBox.setMutationCallback(() => {
          if (scheduledUpdateRef.current) return;
            scheduledUpdateRef.current = true;
            requestAnimationFrame(() => {
              forceVersion(v => v + 1);
              scheduledUpdateRef.current = false;
            });
        });
      } catch(_){}
      // Seed treasure box with current HR readings (handles case monitors already on when session starts)
      try {
        const tb = fitnessSessionRef.current.treasureBox;
        if (tb) {
          fitnessDevices.forEach((device, id) => {
            if (device.type === 'heart_rate' && device.heartRate && device.heartRate > 0) {
              // Find matching user quickly
              users.forEach(u => {
                if (String(u.hrDeviceId) === String(device.deviceId)) {
                  // prime perUser record
                  tb.recordUserHeartRate(u.name, device.heartRate);
                }
              });
            }
          });
        }
      } catch(e) { /* ignore seeding errors */ }
    }
  }, [coinTimeUnitMs, zoneConfig, effectiveUsersConfig, fitnessDevices, users]);

  // Clean up inactive devices periodically using dynamic timeouts
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const { inactive, remove } = getFitnessTimeouts();
      const now = new Date();
      setFitnessDevices(prevDevices => {
        const newDevices = new Map(prevDevices);
        let hasChanges = false;

        for (const [deviceId, device] of newDevices.entries()) {
          const timeSinceLastSeen = now - device.lastSeen;
          if (timeSinceLastSeen > remove) {
            newDevices.delete(deviceId);
            hasChanges = true;
          } else if (timeSinceLastSeen > inactive && device.isActive) {
            // Mutate in place to preserve prototype / methods
            device.isActive = false;
            hasChanges = true; // Map reference changed earlier, so state update will propagate
          }
        }

        // Update session active device list and maybe end session
        try {
          fitnessSessionRef.current.updateActiveDevices(newDevices);
        } catch (e) {
          console.warn('FitnessSession cleanup error', e);
        }

        return hasChanges ? newDevices : prevDevices;
      });
    }, 3000); // Check every 3 seconds

    return () => clearInterval(cleanupInterval);
  }, []); // Empty dependency array ensures this runs only once

  // Manual reconnect helper exposed via context
  const reconnectFitnessWebSocket = React.useCallback(() => {
    try {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      reconnectAttemptsRef.current = 0;
      if (wsRef.current) {
        try { wsRef.current.close(); } catch(_) {}
        wsRef.current = null;
      }
      connectWebSocket();
    } catch(_) {}
  }, []);

  // Connect to WebSocket when the hook is initialized
  useEffect(() => {
    connectWebSocket();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, []); // Empty dependency array ensures this runs only once

  // Prepare data for context value
  const allDevices = Array.from(fitnessDevices.values());
  const allUsers = Array.from(users.values());
  
  // Categorized device arrays
  const heartRateDevices = allDevices.filter(d => d.type === 'heart_rate');
  const speedDevices = allDevices.filter(d => d.type === 'speed');
  const cadenceDevices = allDevices.filter(d => d.type === 'cadence');
  const powerDevices = allDevices.filter(d => d.type === 'power');
  const unknownDevices = allDevices.filter(d => d.type === 'unknown');

  const preferGroupLabels = React.useMemo(() => heartRateDevices.length > 1, [heartRateDevices.length]);

  const getDisplayLabel = React.useCallback((name, { groupLabelOverride, preferGroupLabel } = {}) => {
    if (!name) return null;
    const slug = slugifyId(name);
    const baseGroupLabel = groupLabelOverride !== undefined
      ? groupLabelOverride
      : (slug ? userGroupLabelMap.get(slug) : null);
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

  const governancePolicies = React.useMemo(() => {
    const policiesRaw = governanceConfig?.policies;
    if (!policiesRaw || typeof policiesRaw !== 'object') return [];

    const normalized = [];
    Object.entries(policiesRaw).forEach(([policyId, policyValue]) => {
      if (!policyValue || typeof policyValue !== 'object') return;

      const baseRequirementArray = Array.isArray(policyValue.base_requirement)
        ? policyValue.base_requirement
        : [];
      const baseRequirement = baseRequirementArray.reduce((acc, entry) => {
        if (entry && typeof entry === 'object') {
          Object.entries(entry).forEach(([key, value]) => {
            acc[key] = value;
          });
        }
        return acc;
      }, {});

      const minParticipants = Number.isFinite(policyValue.min_participants)
        ? Number(policyValue.min_participants)
        : Number.isFinite(policyValue.minParticipants)
          ? Number(policyValue.minParticipants)
          : null;

      const challengesRaw = Array.isArray(policyValue.challenges) ? policyValue.challenges : [];
      const challenges = challengesRaw
        .map((challengeValue, index) => {
          if (!challengeValue || typeof challengeValue !== 'object') return null;

          const intervalRaw = challengeValue.interval;
          let minIntervalSeconds;
          let maxIntervalSeconds;
          if (Array.isArray(intervalRaw) && intervalRaw.length >= 2) {
            minIntervalSeconds = Number(intervalRaw[0]);
            maxIntervalSeconds = Number(intervalRaw[1]);
          } else if (Number.isFinite(intervalRaw)) {
            minIntervalSeconds = Number(intervalRaw);
            maxIntervalSeconds = Number(intervalRaw);
          }

          if (!Number.isFinite(minIntervalSeconds) || minIntervalSeconds <= 0) {
            minIntervalSeconds = 180;
          }
          if (!Number.isFinite(maxIntervalSeconds) || maxIntervalSeconds <= 0) {
            maxIntervalSeconds = minIntervalSeconds;
          }
          if (maxIntervalSeconds < minIntervalSeconds) {
            const temp = maxIntervalSeconds;
            maxIntervalSeconds = minIntervalSeconds;
            minIntervalSeconds = temp;
          }

          const selectionList = Array.isArray(challengeValue.selections) ? challengeValue.selections : [];
          const selections = selectionList
            .map((selectionValue, selectionIndex) => {
              if (!selectionValue || typeof selectionValue !== 'object') return null;
              const zone = selectionValue.zone || selectionValue.zoneId || selectionValue.zone_id;
              if (!zone) return null;

              const rule = selectionValue.min_participants ?? selectionValue.minParticipants ?? selectionValue.rule ?? 'all';
              const timeAllowed = Number(selectionValue.time_allowed ?? selectionValue.timeAllowed);
              if (!Number.isFinite(timeAllowed) || timeAllowed <= 0) return null;

              const weight = Number(selectionValue.weight ?? 1);

              return {
                id: `${policyId}_${index}_${selectionIndex}`,
                zone: String(zone),
                rule,
                timeAllowedSeconds: Math.max(1, Math.round(timeAllowed)),
                weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
                label: selectionValue.label || selectionValue.name || null
              };
            })
            .filter(Boolean);

          if (!selections.length) return null;

          const challengeMinParticipants = Number(challengeValue.minParticipants ?? challengeValue.min_participants);

          return {
            id: `${policyId}_challenge_${index}`,
            intervalRangeSeconds: [Math.round(minIntervalSeconds), Math.round(maxIntervalSeconds)],
            minParticipants: Number.isFinite(challengeMinParticipants) && challengeMinParticipants >= 0
              ? challengeMinParticipants
              : null,
            selectionType: typeof challengeValue.selection_type === 'string'
              ? challengeValue.selection_type.toLowerCase()
              : 'random',
            selections
          };
        })
        .filter(Boolean);

      normalized.push({
        id: policyId,
        name: policyValue.name || policyId,
        minParticipants,
        baseRequirement,
        challenges
      });
    });

    return normalized;
  }, [governanceConfig?.policies]);

  const activeParticipantNames = React.useMemo(() => {
    if (!heartRateDevices.length) return [];
    const deviceToUser = new Map();
    users.forEach((user) => {
      if (user?.hrDeviceId != null) {
        deviceToUser.set(String(user.hrDeviceId), user.name);
      }
    });
    Object.entries(guestAssignments || {}).forEach(([deviceId, binding]) => {
      if (binding && binding.name) {
        deviceToUser.set(String(deviceId), binding.name);
      }
    });
    const names = heartRateDevices
      .reduce((acc, device) => {
        if (!device) return acc;
        if (device.type && device.type !== 'heart_rate') return acc;
        if (device.isActive === false) return acc;
        if (Number.isFinite(device.heartRate) && device.heartRate <= 0) return acc;
        if (device.deviceId == null) return acc;
        const name = deviceToUser.get(String(device.deviceId));
        if (name) acc.push(name);
        return acc;
      }, []);
    return Array.from(new Set(names));
  }, [heartRateDevices, users, guestAssignments]);

  const replacedPrimaryPool = React.useMemo(() => {
    if (!guestAssignments || primaryConfigByName.size === 0) return [];
    const seen = new Set();
    const pool = [];
    Object.values(guestAssignments).forEach((assignment) => {
      if (!assignment?.baseUserName) return;
      const config = primaryConfigByName.get(assignment.baseUserName);
      if (!config) return;
      const id = config.id || slugifyId(config.name);
      if (seen.has(id)) return;
      seen.add(id);
      pool.push({
        id,
        name: config.name,
        profileId: config.id || slugifyId(config.name),
        category: 'Family',
        source: 'Family',
        isPrimary: true
      });
    });
    return pool;
  }, [guestAssignments, primaryConfigByName]);

  const participantRoster = React.useMemo(() => {
    const roster = [];
    const normalize = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
    const treasureSummary = fitnessSessionRef.current?.treasureBox
      ? fitnessSessionRef.current.treasureBox.summary
      : null;
    const zoneLookup = new Map();
    if (treasureSummary?.perUser) {
      treasureSummary.perUser.forEach((entry) => {
        if (!entry || !entry.user) return;
        const key = normalize(entry.user);
        if (!key) return;
        zoneLookup.set(key, {
          zoneId: entry.zoneId ? String(entry.zoneId).toLowerCase() : null,
          color: entry.currentColor || null
        });
      });
    }

    heartRateDevices.forEach((device) => {
      if (!device || device.deviceId == null) return;
      const deviceId = String(device.deviceId);
      const heartRate = Number.isFinite(device.heartRate) ? Math.round(device.heartRate) : null;
      const guestBinding = guestAssignments?.[deviceId];
      if (guestBinding?.name) {
        const name = guestBinding.name;
        const key = normalize(name);
        const zoneInfo = zoneLookup.get(key) || null;
        const displayLabel = getDisplayLabel(name, { groupLabelOverride: null, preferGroupLabel: false });
        roster.push({
          name,
          displayLabel,
          profileId: guestBinding.profileId || slugifyId(name),
          baseUserName: guestBinding.baseUserName || null,
          isGuest: true,
          deviceId,
          hrDeviceId: deviceId,
          heartRate,
          zoneId: zoneInfo?.zoneId || null,
          zoneColor: zoneInfo?.color || null,
          source: guestBinding.source || 'Guest',
          userId: guestBinding.profileId || null
        });
        return;
      }

      const mappedUser = hrDeviceUserMapRef.current.get(deviceId);
      if (mappedUser) {
        const name = mappedUser.name;
        const key = normalize(name);
        const zoneInfo = zoneLookup.get(key) || null;
        let resolvedHeartRate = heartRate;
        try {
          const hrValue = mappedUser.currentHeartRate;
          if (Number.isFinite(hrValue)) {
            resolvedHeartRate = Math.round(hrValue);
          }
        } catch (_) {
          // ignore getter issues
        }
        const displayLabel = getDisplayLabel(name);
        roster.push({
          name,
          displayLabel,
          profileId: mappedUser.id || slugifyId(name),
          baseUserName: name,
          isGuest: false,
          deviceId,
          hrDeviceId: deviceId,
          heartRate: resolvedHeartRate,
          zoneId: zoneInfo?.zoneId || null,
          zoneColor: zoneInfo?.color || null,
          source: 'Primary',
          userId: mappedUser.id || null
        });
      }
    });

    return roster;
  }, [heartRateDevices, guestAssignments, users, lastUpdate, governancePulse]);

  const participantLookupByDevice = React.useMemo(() => {
    const map = new Map();
    participantRoster.forEach((entry) => {
      if (!entry || entry.hrDeviceId == null) return;
      map.set(String(entry.hrDeviceId), entry);
    });
    return map;
  }, [participantRoster]);

  const findEffectiveUserConfig = React.useCallback((name) => {
    if (!name) return null;
    const normalized = slugifyId(name);
    if (!normalized) return null;
    const pools = [
      effectiveUsersConfig?.primary,
      effectiveUsersConfig?.secondary,
      effectiveUsersConfig?.family,
      effectiveUsersConfig?.friends
    ];
    for (const pool of pools) {
      if (!Array.isArray(pool)) continue;
      const match = pool.find((entry) => entry?.name && slugifyId(entry.name) === normalized);
      if (match) return match;
    }
    return null;
  }, [effectiveUsersConfig]);

  const getZoneConfigForUser = React.useCallback((name) => {
    if (!name) return normalizedBaseZoneConfig;
    const cacheKey = slugifyId(name);
    if (cacheKey && userZoneConfigCacheRef.current.has(cacheKey)) {
      return userZoneConfigCacheRef.current.get(cacheKey);
    }
    const configEntry = findEffectiveUserConfig(name);
    if (!configEntry || !configEntry.zones) {
      if (cacheKey) {
        userZoneConfigCacheRef.current.set(cacheKey, normalizedBaseZoneConfig);
      }
      return normalizedBaseZoneConfig;
    }
    const derived = buildZoneConfig(zoneConfig, configEntry.zones);
    if (cacheKey) {
      userZoneConfigCacheRef.current.set(cacheKey, derived);
    }
    return derived;
  }, [findEffectiveUserConfig, normalizedBaseZoneConfig, zoneConfig]);

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

    const assignEntry = (name, data = {}) => {
      if (!name) return;
      const key = slugifyId(name);
      if (!key) return;
      const existing = map.get(key) || {};
      map.set(key, {
        name,
        heartRate: Number.isFinite(data.heartRate)
          ? Math.round(data.heartRate)
          : (Number.isFinite(existing.heartRate) ? existing.heartRate : null),
        zoneId: data.zoneId ?? existing.zoneId ?? null,
        zoneName: data.zoneName ?? existing.zoneName ?? null,
        zoneColor: data.zoneColor ?? existing.zoneColor ?? null,
        targetHeartRate: Number.isFinite(data.targetHeartRate)
          ? Math.round(data.targetHeartRate)
          : (Number.isFinite(existing.targetHeartRate) ? existing.targetHeartRate : null),
        rangeMin: Number.isFinite(data.rangeMin) ? data.rangeMin : (existing.rangeMin ?? null),
        rangeMax: Number.isFinite(data.rangeMax) ? data.rangeMax : (existing.rangeMax ?? null),
        progress: Number.isFinite(data.progress) ? data.progress : (existing.progress ?? null),
        showBar: typeof data.showBar === 'boolean' ? data.showBar : (existing.showBar ?? false),
        nextZoneId: data.nextZoneId ?? existing.nextZoneId ?? null,
        source: data.source ?? existing.source ?? null,
        profileId: data.profileId ?? existing.profileId ?? slugifyId(name),
        deviceId: data.deviceId ?? existing.deviceId ?? null,
        isGuest: typeof data.isGuest === 'boolean' ? data.isGuest : (existing.isGuest ?? false),
        displayLabel: data.displayLabel
          || existing.displayLabel
          || getDisplayLabel(name, { preferGroupLabel: false })
      });
    };

    users.forEach((userObj, userName) => {
      if (!userName || !userObj) return;
      const zoneProfile = getZoneConfigForUser(userName) || normalizedBaseZoneConfig;
      const snapshot = userObj.zoneProgress
        || deriveZoneProgressSnapshot({ zoneConfig: zoneProfile, heartRate: userObj.currentHeartRate });
      const hrValue = Number.isFinite(snapshot?.currentHR)
        ? snapshot.currentHR
        : (Number.isFinite(userObj.currentHeartRate) ? userObj.currentHeartRate : null);
      assignEntry(userName, {
        heartRate: hrValue,
        zoneId: snapshot?.currentZoneId ?? null,
        zoneName: snapshot?.currentZoneName ?? null,
        zoneColor: snapshot?.currentZoneColor ?? null,
        targetHeartRate: snapshot?.targetHeartRate ?? null,
        rangeMin: snapshot?.rangeMin ?? null,
        rangeMax: snapshot?.rangeMax ?? null,
        progress: snapshot?.progress ?? null,
        showBar: snapshot?.showBar ?? false,
        nextZoneId: snapshot?.nextZoneId ?? null,
        source: 'Primary',
        profileId: userObj.id || slugifyId(userName),
        displayLabel: getDisplayLabel(userName)
      });
    });

    participantRoster.forEach((participant) => {
      if (!participant?.name) return;
      const hrValue = Number.isFinite(participant.heartRate) ? participant.heartRate : null;
      const zoneProfile = getZoneConfigForUser(participant.name) || normalizedBaseZoneConfig;
      const snapshot = deriveZoneProgressSnapshot({ zoneConfig: zoneProfile, heartRate: hrValue });
      assignEntry(participant.name, {
        heartRate: hrValue,
        zoneId: snapshot?.currentZoneId ?? participant.zoneId ?? null,
        zoneName: snapshot?.currentZoneName ?? null,
        zoneColor: snapshot?.currentZoneColor ?? participant.zoneColor ?? null,
        targetHeartRate: snapshot?.targetHeartRate ?? null,
        rangeMin: snapshot?.rangeMin ?? null,
        rangeMax: snapshot?.rangeMax ?? null,
        progress: snapshot?.progress ?? null,
        showBar: snapshot?.showBar ?? false,
        nextZoneId: snapshot?.nextZoneId ?? null,
        source: participant.source || null,
        profileId: participant.profileId || participant.userId || slugifyId(participant.name),
        deviceId: participant.hrDeviceId || participant.deviceId || null,
        isGuest: Boolean(participant.isGuest),
        displayLabel: participant.displayLabel || getDisplayLabel(participant.name, { preferGroupLabel: false })
      });
    });

    return map;
  }, [users, participantRoster, getZoneConfigForUser, normalizedBaseZoneConfig]);

  const userHeartRateMap = React.useMemo(() => {
    const map = new Map();
    userVitalsMap.forEach((entry, key) => {
      if (!entry) return;
      if (!Number.isFinite(entry.heartRate)) return;
      map.set(key, entry.heartRate);
    });
    return map;
  }, [userVitalsMap]);

  const getUserVitals = React.useCallback((name) => {
    if (!name) return null;
    const slug = slugifyId(name);
    if (!slug) return null;
    const existing = userVitalsMap.get(slug) || null;
    const normalized = typeof name === 'string' ? name.trim().toLowerCase() : '';
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
    const mergedProfileId = existing?.profileId || participant?.profileId || participant?.userId || slug;
    const mergedDeviceId = existing?.deviceId || participant?.hrDeviceId || participant?.deviceId || null;
    const mergedSource = existing?.source || participant?.source || null;
    const mergedDisplayLabel = existing?.displayLabel
      || participant?.displayLabel
      || getDisplayLabel(participant?.name || name, { preferGroupLabel: false });

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

  const userZoneProgress = React.useMemo(() => {
    const progressMap = new Map();
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
        zoneColor: entry.zoneColor ?? null
      });
    });
    return progressMap;
  }, [userVitalsMap]);

  const getUserZoneThreshold = React.useCallback((userName, zoneId) => {
    if (!zoneId) return null;
    const zoneProfile = getZoneConfigForUser(userName) || normalizedBaseZoneConfig;
    return resolveZoneThreshold(zoneProfile, zoneId);
  }, [getZoneConfigForUser, normalizedBaseZoneConfig]);

  useEffect(() => {
    if (fitnessSessionRef.current && typeof fitnessSessionRef.current.setParticipantRoster === 'function') {
      fitnessSessionRef.current.setParticipantRoster(participantRoster, guestAssignments);
    }
  }, [participantRoster, guestAssignments]);

  useEffect(() => {
    if (!voiceMemoOverlayState.open) return;
    if (voiceMemoOverlayState.mode === 'list' && voiceMemos.length === 0) {
      setVoiceMemoOverlayState(VOICE_MEMO_OVERLAY_INITIAL);
      return;
    }
    if (voiceMemoOverlayState.memoId) {
      const exists = voiceMemos.some((memo) => memo && String(memo.memoId) === String(voiceMemoOverlayState.memoId));
      if (!exists && voiceMemoOverlayState.mode !== 'redo') {
        setVoiceMemoOverlayState((prev) => ({ ...prev, memoId: null }));
      }
    }
  }, [voiceMemoOverlayState, voiceMemos, setVoiceMemoOverlayState]);

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
        console.warn('[FitnessContext] session updateSnapshot failed', error);
      }
    }
  }, [users, fitnessDevices, fitnessPlayQueue, participantRoster, zoneConfig]);

  useEffect(() => {
    if (governanceTimerRef.current) {
      clearTimeout(governanceTimerRef.current);
      governanceTimerRef.current = null;
    }

    const clearChallengeState = ({ preserveHistory = false } = {}) => {
      if (governanceChallengeTimerRef.current) {
        clearTimeout(governanceChallengeTimerRef.current);
        governanceChallengeTimerRef.current = null;
      }
      const challengeState = governanceChallengeRef.current;
      challengeState.nextChallengeAt = null;
      challengeState.nextChallengeRemainingMs = null;
      challengeState.nextChallenge = null;
      challengeState.activeChallenge = null;
      challengeState.videoLocked = false;
      challengeState.forceStartRequest = null;
      challengeState.selectionRandomBag = {};
      if (!preserveHistory) {
        challengeState.activePolicyId = null;
        challengeState.activePolicyName = null;
        challengeState.selectionCursor = {};
        challengeState.challengeHistory = [];
      }
    };

    const media = governanceMedia;
    const setRequirementSummary = (policy, requirements) => {
      governanceRequirementSummaryRef.current = {
        policyId: policy?.id ?? null,
        targetUserCount: Number.isFinite(policy?.minParticipants) ? policy.minParticipants : null,
        requirements: Array.isArray(requirements) ? requirements : [],
        activeCount: activeParticipantNames.length
      };
    };

    if (!media || !media.id) {
      governanceMetaRef.current.satisfiedOnce = false;
      governanceMetaRef.current.deadline = null;
      governanceMetaRef.current.gracePeriodTotal = null;
      updateGovernancePhase(null);
      setRequirementSummary(null, []);
      clearChallengeState();
      return;
    }

    if (!governedLabelSet.size) {
      governanceMetaRef.current.satisfiedOnce = false;
      governanceMetaRef.current.deadline = null;
      governanceMetaRef.current.gracePeriodTotal = null;
      updateGovernancePhase(null);
      setRequirementSummary(null, []);
      clearChallengeState();
      return;
    }

    const hasGovernedLabel = media.labels.some((label) => governedLabelSet.has(label));
    if (!hasGovernedLabel) {
      governanceMetaRef.current.satisfiedOnce = false;
      governanceMetaRef.current.deadline = null;
      governanceMetaRef.current.gracePeriodTotal = null;
      updateGovernancePhase(null);
      setRequirementSummary(null, []);
      clearChallengeState({ preserveHistory: true });
      return;
    }

    if (activeParticipantNames.length === 0) {
      governanceMetaRef.current.satisfiedOnce = false;
      governanceMetaRef.current.deadline = null;
      governanceMetaRef.current.gracePeriodTotal = null;
      updateGovernancePhase('init');
      setRequirementSummary(null, []);
      clearChallengeState({ preserveHistory: true });
      return;
    }

    const totalCount = activeParticipantNames.length;
    const defaultGrace = Number.isFinite(governanceConfig?.grace_period_seconds)
      ? governanceConfig.grace_period_seconds
      : 0;

    const computeUserZones = () => {
      const result = {};
      try {
        userVitalsMap.forEach((entry) => {
          if (!entry?.name) return;
          if (result[entry.name]) return;
          result[entry.name] = entry.zoneId ? String(entry.zoneId).toLowerCase() : null;
        });
      } catch (_) {}

      const tb = fitnessSessionRef.current?.treasureBox;
      if (tb && tb.perUser) {
        try {
          tb.perUser.forEach((val, key) => {
            if (!key || result[key]) return;
            if (!val) {
              result[key] = null;
              return;
            }
            const color = val.currentColor || val.lastColor || null;
            let zoneId = val.zoneId || val.lastZoneId || null;
            if (!zoneId && color && tb.globalZones && tb.globalZones.length) {
              const match = tb.globalZones.find((zone) => String(zone.color).toLowerCase() === String(color).toLowerCase());
              if (match) {
                zoneId = match.id || match.name || null;
              }
            }
            if (!zoneId && color) {
              const mapped = colorToZoneId[String(color).toLowerCase()];
              if (mapped) zoneId = mapped;
            }
            result[key] = zoneId ? String(zoneId).toLowerCase() : null;
          });
        } catch (_) {}
      }
      return result;
    };

    const userZoneMap = computeUserZones();
    const deriveZoneId = (name) => {
      let zoneId = userZoneMap[name] || null;
      // Fallback: if guest name not found in TreasureBox yet, try baseUserName
      if (!zoneId) {
        const normalized = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const participant = participantLookupByName.get(normalized);
        if (participant?.baseUserName && participant.baseUserName !== name) {
          zoneId = userZoneMap[participant.baseUserName] || null;
          if (FITNESS_DEBUG && zoneId) {
            console.log('[FitnessContext][GOVERNANCE] Fallback zone for guest:', name, '→ baseUser:', participant.baseUserName, 'zone:', zoneId);
          }
        }
      }
      return zoneId;
    };

    const normalizeRequiredCount = (rule) => {
      if (typeof rule === 'number' && Number.isFinite(rule)) {
        return Math.min(Math.max(0, Math.round(rule)), totalCount);
      }
      if (typeof rule === 'string') {
        const normalized = rule.toLowerCase().trim();
        if (normalized === 'all') return totalCount;
        if (normalized === 'majority' || normalized === 'most') {
          return Math.max(1, Math.ceil(totalCount * 0.5));
        }
        if (normalized === 'some') {
          return Math.max(1, Math.ceil(totalCount * 0.3));
        }
        if (normalized === 'any') {
          return 1;
        }
        const numeric = Number(rule);
        if (Number.isFinite(numeric)) {
          return Math.min(Math.max(0, Math.round(numeric)), totalCount);
        }
      }
      return totalCount;
    };

    const describeRule = (rule, requiredCount) => {
      if (typeof rule === 'number' && Number.isFinite(rule)) {
        return `${requiredCount} participant${requiredCount === 1 ? '' : 's'}`;
      }
      if (typeof rule === 'string') {
        const normalized = rule.toLowerCase().trim();
        switch (normalized) {
          case 'all':
            return 'All participants';
          case 'majority':
            return `Majority (${requiredCount})`;
          case 'most':
            return `Most (${requiredCount})`;
          case 'some':
            return `Some (${requiredCount})`;
          case 'any':
            return 'Any participant';
          default:
            break;
        }
      }
      return `${requiredCount} participant${requiredCount === 1 ? '' : 's'}`;
    };

    const evaluateZoneRequirement = (zoneKey, rule) => {
      const zoneId = zoneKey ? String(zoneKey).toLowerCase() : null;
      if (!zoneId) return null;
      const requiredRank = zoneRankMap[zoneId];
      if (!Number.isFinite(requiredRank)) return null;

      const metUsers = [];
      activeParticipantNames.forEach((name) => {
        const participantZoneId = deriveZoneId(name);
        const participantRank = participantZoneId && Number.isFinite(zoneRankMap[participantZoneId])
          ? zoneRankMap[participantZoneId]
          : 0;
        if (FITNESS_DEBUG) {
          console.log('[FitnessContext][CHALLENGE] Evaluating:', name, 'zoneId:', participantZoneId, 'rank:', participantRank, 'required:', requiredRank, 'met:', participantRank >= requiredRank);
        }
        if (participantRank >= requiredRank) {
          metUsers.push(name);
        }
      });

      const requiredCount = normalizeRequiredCount(rule);
      const satisfied = metUsers.length >= requiredCount;
      const missingUsers = activeParticipantNames.filter((name) => !metUsers.includes(name));
      const zoneInfo = zoneInfoMap[zoneId];

      return {
        zone: zoneId,
        zoneLabel: zoneInfo?.name || zoneId,
        rule,
        ruleLabel: describeRule(rule, requiredCount),
        requiredCount,
        actualCount: metUsers.length,
        metUsers,
        missingUsers,
        satisfied
      };
    };

    const evaluateRequirementSet = (requirementMap) => {
      if (!requirementMap || typeof requirementMap !== 'object') {
        return { summaries: [], allSatisfied: true };
      }
      const entries = Object.entries(requirementMap).filter(([key]) => key !== 'grace_period_seconds');
      if (!entries.length) {
        return { summaries: [], allSatisfied: true };
      }
      const summaries = [];
      let allSatisfied = true;
      entries.forEach(([zoneKey, rule]) => {
        const summary = evaluateZoneRequirement(zoneKey, rule);
        if (summary) {
          summaries.push(summary);
          if (!summary.satisfied) {
            allSatisfied = false;
          }
        }
      });
      return { summaries, allSatisfied };
    };

    const chooseActivePolicy = () => {
      if (!governancePolicies.length) return null;
      let fallback = governancePolicies[0];
      let chosen = null;
      governancePolicies.forEach((policy) => {
        const threshold = Number.isFinite(policy.minParticipants) ? policy.minParticipants : 0;
        if (threshold <= totalCount) {
          if (!chosen || threshold > (Number.isFinite(chosen.minParticipants) ? chosen.minParticipants : -1)) {
            chosen = policy;
          }
        }
        if (!fallback) {
          fallback = policy;
        } else {
          const fallbackThreshold = Number.isFinite(fallback.minParticipants) ? fallback.minParticipants : Infinity;
          if (Number.isFinite(policy.minParticipants) && policy.minParticipants < fallbackThreshold) {
            fallback = policy;
          }
        }
      });
      return chosen || fallback;
    };

    const activePolicy = chooseActivePolicy();
    if (!activePolicy) {
      governanceMetaRef.current.satisfiedOnce = false;
      governanceMetaRef.current.deadline = null;
      governanceMetaRef.current.gracePeriodTotal = null;
      updateGovernancePhase('init');
      setRequirementSummary(null, []);
      clearChallengeState({ preserveHistory: true });
      return;
    }

  const challengeState = governanceChallengeRef.current;
  const forceStartRequest = challengeState.forceStartRequest || null;
  const challengeForcesRed = Boolean(
    challengeState.activeChallenge && challengeState.activeChallenge.status === 'failed'
  );
    const activePolicyId = activePolicy.id || null;
    if (challengeState.activePolicyId !== activePolicyId) {
      if (governanceChallengeTimerRef.current) {
        clearTimeout(governanceChallengeTimerRef.current);
        governanceChallengeTimerRef.current = null;
      }
      challengeState.activePolicyId = activePolicyId;
      challengeState.activePolicyName = activePolicy.name || activePolicy.id || null;
      challengeState.selectionCursor = {};
      challengeState.activeChallenge = null;
      challengeState.nextChallengeAt = null;
      challengeState.nextChallengeRemainingMs = null;
      challengeState.nextChallenge = null;
      challengeState.videoLocked = false;
    }

    const baseRequirement = activePolicy.baseRequirement || {};
    const { summaries: requirementSummaries, allSatisfied } = evaluateRequirementSet(baseRequirement);
    setRequirementSummary(activePolicy, requirementSummaries);

    const baseGraceSeconds = Number.isFinite(baseRequirement.grace_period_seconds)
      ? baseRequirement.grace_period_seconds
      : defaultGrace;

    if (challengeForcesRed) {
      if (governanceTimerRef.current) {
        clearTimeout(governanceTimerRef.current);
        governanceTimerRef.current = null;
      }
      governanceMetaRef.current.deadline = null;
      governanceMetaRef.current.gracePeriodTotal = null;
      updateGovernancePhase('red');
    } else if (allSatisfied) {
      governanceMetaRef.current.satisfiedOnce = true;
      governanceMetaRef.current.deadline = null;
      governanceMetaRef.current.gracePeriodTotal = null;
      updateGovernancePhase('green');
    } else if (!governanceMetaRef.current.satisfiedOnce) {
      governanceMetaRef.current.deadline = null;
      governanceMetaRef.current.gracePeriodTotal = null;
      updateGovernancePhase('init');
    } else {
      let graceSeconds = baseGraceSeconds;
      if (!Number.isFinite(graceSeconds) || graceSeconds <= 0) {
        if (governanceTimerRef.current) {
          clearTimeout(governanceTimerRef.current);
          governanceTimerRef.current = null;
        }
        governanceMetaRef.current.deadline = null;
        governanceMetaRef.current.gracePeriodTotal = null;
        updateGovernancePhase('red');
      } else {
        const now = Date.now();
        const existingDeadline = governanceMetaRef.current.deadline;
        if (!Number.isFinite(existingDeadline) && governancePhase !== 'red') {
          governanceMetaRef.current.deadline = now + graceSeconds * 1000;
          governanceMetaRef.current.gracePeriodTotal = graceSeconds;
        }
        const activeDeadline = governanceMetaRef.current.deadline;
        if (!Number.isFinite(activeDeadline)) {
          if (governanceTimerRef.current) {
            clearTimeout(governanceTimerRef.current);
            governanceTimerRef.current = null;
          }
          governanceMetaRef.current.gracePeriodTotal = null;
          updateGovernancePhase('red');
        } else {
          const remainingMs = activeDeadline - now;
          if (remainingMs <= 0) {
            if (governanceTimerRef.current) {
              clearTimeout(governanceTimerRef.current);
              governanceTimerRef.current = null;
            }
            governanceMetaRef.current.deadline = null;
            governanceMetaRef.current.gracePeriodTotal = null;
            updateGovernancePhase('red');
          } else {
            if (governanceTimerRef.current) {
              clearTimeout(governanceTimerRef.current);
            }
            governanceTimerRef.current = setTimeout(() => {
              setGovernancePulse((pulse) => pulse + 1);
            }, remainingMs);
            updateGovernancePhase('yellow');
          }
        }
      }
    }

    const scheduleChallengePulse = (delayMs) => {
      if (governanceChallengeTimerRef.current) {
        clearTimeout(governanceChallengeTimerRef.current);
        governanceChallengeTimerRef.current = null;
      }
      if (Number.isFinite(delayMs) && delayMs > 0) {
        governanceChallengeTimerRef.current = setTimeout(() => {
          setGovernancePulse((pulse) => pulse + 1);
        }, delayMs);
      }
    };

    const pickIntervalMs = (intervalRangeSeconds) => {
      if (!Array.isArray(intervalRangeSeconds) || intervalRangeSeconds.length < 2) {
        const single = Array.isArray(intervalRangeSeconds) ? intervalRangeSeconds[0] : intervalRangeSeconds;
        const seconds = Number.isFinite(single) && single > 0 ? Number(single) : 180;
        return Math.max(1, Math.round(seconds * 1000));
      }
      const rawMin = Number(intervalRangeSeconds[0]);
      const rawMax = Number(intervalRangeSeconds[1]);
      const minSec = Number.isFinite(rawMin) && rawMin > 0 ? rawMin : 180;
      const maxSec = Number.isFinite(rawMax) && rawMax > minSec ? rawMax : minSec;
      const chosenSec = minSec + Math.random() * (maxSec - minSec);
      return Math.max(1, Math.round(chosenSec * 1000));
    };

    const challengeConfig = Array.isArray(activePolicy.challenges) && activePolicy.challenges.length
      ? activePolicy.challenges[0]
      : null;

    if (!challengeConfig) {
      challengeState.activeChallenge = null;
      challengeState.nextChallengeAt = null;
      challengeState.nextChallenge = null;
      challengeState.videoLocked = false;
      scheduleChallengePulse(null);
      return;
    }

    const challengeMinParticipants = Number.isFinite(challengeConfig.minParticipants) ? challengeConfig.minParticipants : null;
    const eligibleForChallenge = challengeMinParticipants == null || totalCount >= challengeMinParticipants;

    if (!eligibleForChallenge && !forceStartRequest) {
      challengeState.nextChallengeAt = null;
      challengeState.nextChallenge = null;
      challengeState.activeChallenge = null;
      challengeState.videoLocked = false;
      scheduleChallengePulse(null);
      return;
    }

  const nowTs = Date.now();
  const isGreenPhase = governancePhase === 'green';

    const buildChallengeSummary = (challenge) => {
      if (!challenge) return null;
      const summary = evaluateZoneRequirement(challenge.zone, challenge.rule);
      if (!summary) return null;

      const status = challenge.status;
      const isPending = status === 'pending';
      const isPaused = isPending && (!isGreenPhase || Boolean(challenge.pausedAt));
      let remainingMs;
      if (status === 'success') {
        remainingMs = 0;
      } else if (status === 'failed') {
        remainingMs = 0;
      } else if (isPaused) {
        if (Number.isFinite(challenge.pausedRemainingMs)) {
          remainingMs = Math.max(0, challenge.pausedRemainingMs);
        } else if (Number.isFinite(challenge.pausedAt) && Number.isFinite(challenge.expiresAt)) {
          remainingMs = Math.max(0, challenge.expiresAt - challenge.pausedAt);
        } else if (Number.isFinite(challenge.expiresAt)) {
          remainingMs = Math.max(0, challenge.expiresAt - nowTs);
        } else {
          remainingMs = 0;
        }
      } else {
        remainingMs = Math.max(0, challenge.expiresAt - nowTs);
      }

      if (isPaused && (!Number.isFinite(challenge.pausedRemainingMs) || challenge.pausedRemainingMs < 0)) {
        challenge.pausedRemainingMs = remainingMs;
      }

      return {
        ...summary,
        remainingSeconds: Math.max(0, Math.ceil(remainingMs / 1000)),
        totalSeconds: challenge.timeLimitSeconds,
        status,
        startedAt: challenge.startedAt,
        completedAt: challenge.completedAt || null,
        expiresAt: challenge.expiresAt,
        selectionLabel: challenge.selectionLabel || null,
        paused: isPaused
      };
    };

    const getSelectionPool = () => {
      const selectionList = Array.isArray(challengeConfig.selections) ? challengeConfig.selections : [];
      if (!selectionList.length) return [];
      let candidates = selectionList.filter((selection) => {
        const requiredCount = normalizeRequiredCount(selection.rule);
        return Number.isFinite(requiredCount) && requiredCount > 0 && requiredCount <= totalCount;
      });
      if (!candidates.length) {
        candidates = selectionList;
      }
      return candidates;
    };

    const shuffleArray = (list) => {
      for (let i = list.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = list[i];
        list[i] = list[j];
        list[j] = temp;
      }
      return list;
    };

    const chooseSelectionPayload = () => {
      const pool = getSelectionPool();
      if (!pool.length) return null;

      let chosenSelection = null;
      let cursorIndex = null;

      if (challengeConfig.selectionType === 'cyclic') {
        const cursorKey = challengeConfig.id;
        const previous = Number.isFinite(challengeState.selectionCursor[cursorKey])
          ? challengeState.selectionCursor[cursorKey]
          : -1;
        const nextIndex = (previous + 1) % pool.length;
        chosenSelection = pool[nextIndex];
        cursorIndex = nextIndex;
      } else if (challengeConfig.selectionType === 'random') {
        const bagKey = challengeConfig.id;
        let remaining = governanceChallengeRef.current.selectionRandomBag[bagKey];
        const needsReset = !Array.isArray(remaining)
          || remaining.length === 0
          || remaining.some((index) => !Number.isInteger(index) || index < 0 || index >= pool.length);
        if (needsReset) {
          remaining = pool.map((_, idx) => idx);
        }
        if (!remaining.length) {
          return null;
        }
        const shuffled = shuffleArray([...remaining]);
        const [nextIndex, ...rest] = shuffled;
        governanceChallengeRef.current.selectionRandomBag[bagKey] = rest;
        chosenSelection = pool[nextIndex];
        cursorIndex = nextIndex;
      } else {
        const totalWeight = pool.reduce((sum, selection) => sum + (selection.weight || 1), 0);
        let pick = Math.random() * (totalWeight || 1);
        for (const selection of pool) {
          pick -= selection.weight || 1;
          if (pick <= 0) {
            chosenSelection = selection;
            break;
          }
        }
        if (!chosenSelection) {
          chosenSelection = pool[pool.length - 1];
        }
      }

      if (!chosenSelection) return null;

      const requiredCount = normalizeRequiredCount(chosenSelection.rule);
      if (!Number.isFinite(requiredCount) || requiredCount <= 0) {
        return null;
      }

      return {
        selection: chosenSelection,
        cursorIndex,
        requiredCount
      };
    };

    const assignNextChallengePreview = (scheduledForTs, payload) => {
      if (!payload || !payload.selection) {
        challengeState.nextChallenge = null;
        return null;
      }
      const challengeZone = payload.selection.zone ? String(payload.selection.zone).toLowerCase() : null;
      const timeLimitSeconds = Number.isFinite(payload.selection.timeAllowedSeconds) && payload.selection.timeAllowedSeconds > 0
        ? Math.round(payload.selection.timeAllowedSeconds)
        : 60;

      challengeState.nextChallenge = {
        configId: challengeConfig.id,
        selectionId: payload.selection.id,
        selectionLabel: payload.selection.label || null,
        zone: challengeZone,
        rule: payload.selection.rule,
        requiredCount: payload.requiredCount,
        timeLimitSeconds,
        cursorIndex: payload.cursorIndex ?? null,
        scheduledFor: scheduledForTs
      };
      return challengeState.nextChallenge;
    };

    const ensureNextChallengePreview = ({ scheduledFor } = {}) => {
      const baseTarget = Number.isFinite(scheduledFor)
        ? scheduledFor
        : Number.isFinite(challengeState.nextChallengeAt)
          ? challengeState.nextChallengeAt
          : Number.isFinite(challengeState.nextChallengeRemainingMs)
            ? nowTs + challengeState.nextChallengeRemainingMs
            : null;
      const targetTs = Number.isFinite(baseTarget) ? baseTarget : null;
      const isGreenPhase = governancePhase === 'green';
      if (!Number.isFinite(targetTs)) {
        challengeState.nextChallenge = null;
        return false;
      }

      if (targetTs <= nowTs && !isGreenPhase) {
        challengeState.nextChallenge = null;
        return false;
      }

      const existing = challengeState.nextChallenge;
      if (
        existing &&
        existing.configId === challengeConfig.id &&
        Math.abs((existing.scheduledFor ?? targetTs) - targetTs) < 5 &&
        Number.isFinite(existing.requiredCount) &&
        existing.requiredCount > 0 &&
        existing.requiredCount <= totalCount
      ) {
        return true;
      }

      const payload = chooseSelectionPayload();
      if (!payload) {
        challengeState.nextChallenge = null;
        return false;
      }

      assignNextChallengePreview(targetTs, payload);
      return true;
    };

    const queueNextChallenge = (delayMs) => {
      const normalizedDelay = Number.isFinite(delayMs) && delayMs > 0 ? Math.max(50, Math.round(delayMs)) : 1000;
      const scheduledFor = nowTs + normalizedDelay;
      challengeState.nextChallengeAt = scheduledFor;
      challengeState.nextChallengeRemainingMs = normalizedDelay;
      if (!ensureNextChallengePreview({ scheduledFor })) {
        challengeState.nextChallengeAt = null;
        challengeState.nextChallengeRemainingMs = null;
        scheduleChallengePulse(null);
        return false;
      }
      scheduleChallengePulse(Math.max(50, scheduledFor - nowTs));
      return true;
    };

    const startChallenge = (options = {}) => {
      const { previewOverride = null, forced = false } = options;

      let preview = null;
      if (previewOverride) {
        preview = assignNextChallengePreview(nowTs, previewOverride);
      } else if (challengeState.nextChallenge && challengeState.nextChallenge.configId === challengeConfig.id) {
        preview = challengeState.nextChallenge;
      } else {
        const payload = chooseSelectionPayload();
        preview = assignNextChallengePreview(nowTs, payload);
      }

      if (!preview) {
        challengeState.forceStartRequest = null;
        scheduleChallengePulse(null);
        return false;
      }

      const timeLimitSeconds = Number.isFinite(preview.timeLimitSeconds) && preview.timeLimitSeconds > 0
        ? Math.round(preview.timeLimitSeconds)
        : 60;
      const startedAt = nowTs;
      const expiresAt = startedAt + timeLimitSeconds * 1000;
      const requiredCount = Number.isFinite(preview.requiredCount) && preview.requiredCount > 0
        ? preview.requiredCount
        : normalizeRequiredCount(preview.rule);

      challengeState.activeChallenge = {
        id: `${challengeConfig.id}_${startedAt}`,
        policyId: activePolicyId,
        policyName: challengeState.activePolicyName,
        configId: challengeConfig.id,
        selectionId: preview.selectionId,
        selectionLabel: preview.selectionLabel || null,
        zone: preview.zone,
        rule: preview.rule,
        requiredCount,
        timeLimitSeconds,
        startedAt,
        expiresAt,
        status: 'pending',
        historyRecorded: false,
        summary: null,
        pausedAt: null,
        pausedRemainingMs: null
      };
      challengeState.nextChallenge = null;
      challengeState.nextChallengeAt = null;
      challengeState.nextChallengeRemainingMs = null;
      challengeState.videoLocked = false;

      if (challengeConfig.selectionType === 'cyclic' && Number.isInteger(preview.cursorIndex)) {
        challengeState.selectionCursor[challengeConfig.id] = preview.cursorIndex;
      }

      challengeState.forceStartRequest = null;
      scheduleChallengePulse(Math.max(50, expiresAt - startedAt));
      return true;
    };

    if (challengeState.activeChallenge) {
      if (forceStartRequest) {
        challengeState.activeChallenge = null;
        challengeState.videoLocked = false;
      } else {
        const challenge = challengeState.activeChallenge;
        if (challenge.status === 'pending') {
          if (!isGreenPhase) {
            if (!challenge.pausedAt) {
              challenge.pausedAt = nowTs;
              challenge.pausedRemainingMs = Math.max(0, challenge.expiresAt - nowTs);
            }
            challenge.summary = buildChallengeSummary(challenge);
            scheduleChallengePulse(500);
            return;
          }

          if (challenge.pausedAt) {
            const resumeRemainingMs = Number.isFinite(challenge.pausedRemainingMs)
              ? Math.max(0, challenge.pausedRemainingMs)
              : Math.max(0, challenge.expiresAt - challenge.pausedAt);
            challenge.expiresAt = nowTs + resumeRemainingMs;
            challenge.pausedAt = null;
            challenge.pausedRemainingMs = null;
          }

          challenge.summary = buildChallengeSummary(challenge);

          if (challenge.summary?.satisfied) {
            challenge.status = 'success';
            challenge.completedAt = nowTs;
            challenge.pausedAt = null;
            challenge.pausedRemainingMs = null;
            challenge.summary = buildChallengeSummary(challenge);
            if (!challenge.historyRecorded) {
              challengeState.challengeHistory.push({
                id: challenge.id,
                status: 'success',
                zone: challenge.zone,
                zoneLabel: challenge.summary?.zoneLabel || null,
                rule: challenge.rule,
                requiredCount: challenge.requiredCount,
                startedAt: challenge.startedAt,
                completedAt: challenge.completedAt,
                selectionLabel: challenge.selectionLabel || null
              });
              if (challengeState.challengeHistory.length > 20) {
                challengeState.challengeHistory.splice(0, challengeState.challengeHistory.length - 20);
              }
              challenge.historyRecorded = true;
            }
            challengeState.videoLocked = false;
            const nextDelay = pickIntervalMs(challengeConfig.intervalRangeSeconds);
            queueNextChallenge(nextDelay);
            scheduleChallengePulse(50);
            return;
          } else if (nowTs >= challenge.expiresAt) {
            challenge.status = 'failed';
            challenge.completedAt = null;
            challenge.pausedAt = null;
            challenge.pausedRemainingMs = null;
            challenge.summary = buildChallengeSummary(challenge);
            challengeState.videoLocked = true;
            challengeState.nextChallenge = null;
            challengeState.nextChallengeAt = null;
            challengeState.nextChallengeRemainingMs = null;
            if (governanceTimerRef.current) {
              clearTimeout(governanceTimerRef.current);
              governanceTimerRef.current = null;
            }
            governanceMetaRef.current.deadline = null;
            governanceMetaRef.current.gracePeriodTotal = null;
            updateGovernancePhase('red');
            scheduleChallengePulse(500);
            return;
          } else {
            scheduleChallengePulse(Math.max(50, challenge.expiresAt - nowTs));
            return;
          }
        } else {
          challenge.pausedAt = null;
          challenge.pausedRemainingMs = null;
          challenge.summary = buildChallengeSummary(challenge);

          if (challenge.status === 'success') {
            const completedAt = challenge.completedAt || nowTs;
            const remainingFlash = Math.max(0, 2000 - (nowTs - completedAt));
            if (remainingFlash > 0) {
              scheduleChallengePulse(Math.max(50, remainingFlash));
            } else {
              challengeState.activeChallenge = null;
              scheduleChallengePulse(50);
            }
            return;
          }

          if (challenge.status === 'failed') {
            if (challenge.summary?.satisfied) {
              challenge.status = 'success';
              challenge.completedAt = nowTs;
              challenge.summary = buildChallengeSummary(challenge);
              challengeState.videoLocked = false;
              if (!challenge.historyRecorded) {
                challengeState.challengeHistory.push({
                  id: challenge.id,
                  status: 'success',
                  zone: challenge.zone,
                  zoneLabel: challenge.summary?.zoneLabel || null,
                  rule: challenge.rule,
                  requiredCount: challenge.requiredCount,
                  startedAt: challenge.startedAt,
                  completedAt: challenge.completedAt,
                  selectionLabel: challenge.selectionLabel || null
                });
                if (challengeState.challengeHistory.length > 20) {
                  challengeState.challengeHistory.splice(0, challengeState.challengeHistory.length - 20);
                }
                challenge.historyRecorded = true;
              }
              const nextDelay = pickIntervalMs(challengeConfig.intervalRangeSeconds);
              queueNextChallenge(nextDelay);
              scheduleChallengePulse(50);
            } else {
              challengeState.videoLocked = true;
              scheduleChallengePulse(500);
            }
            return;
          }

          if (challengeState.nextChallengeAt != null) {
            ensureNextChallengePreview({});
            if (nowTs >= challengeState.nextChallengeAt) {
              challengeState.activeChallenge = null;
              challengeState.nextChallengeAt = null;
              if (!startChallenge()) {
                const fallbackDelay = pickIntervalMs(challengeConfig.intervalRangeSeconds);
                queueNextChallenge(fallbackDelay);
              }
            } else {
              scheduleChallengePulse(Math.max(50, challengeState.nextChallengeAt - nowTs));
            }
          } else {
            challengeState.activeChallenge = null;
            scheduleChallengePulse(null);
          }
        }
        return;
      }
    }

    const shouldForceStart = Boolean(forceStartRequest);
    const forcePreviewPayload = shouldForceStart && forceStartRequest?.payload && typeof forceStartRequest.payload === 'object'
      ? { ...forceStartRequest.payload }
      : null;

    if (!isGreenPhase && !shouldForceStart) {
      if (Number.isFinite(challengeState.nextChallengeAt)) {
        challengeState.nextChallengeRemainingMs = Math.max(0, challengeState.nextChallengeAt - nowTs);
        challengeState.nextChallengeAt = null;
      }
      scheduleChallengePulse(null);
      return;
    }

    if (shouldForceStart) {
      const started = startChallenge({ previewOverride: forcePreviewPayload, forced: true });
      if (!started && !isGreenPhase) {
        scheduleChallengePulse(1000);
      }
      return;
    }

    if (challengeState.nextChallengeAt == null && Number.isFinite(challengeState.nextChallengeRemainingMs) && challengeState.nextChallengeRemainingMs > 0) {
      challengeState.nextChallengeAt = nowTs + challengeState.nextChallengeRemainingMs;
      challengeState.nextChallengeRemainingMs = null;
    }

    if (challengeState.nextChallengeAt == null) {
      const delayMs = pickIntervalMs(challengeConfig.intervalRangeSeconds);
      if (!queueNextChallenge(delayMs)) {
        return;
      }
    } else if (!ensureNextChallengePreview({})) {
      const delayMs = pickIntervalMs(challengeConfig.intervalRangeSeconds);
      if (!queueNextChallenge(delayMs)) {
        return;
      }
    }

    if (challengeState.nextChallengeAt != null) {
      if (nowTs >= challengeState.nextChallengeAt) {
        if (!startChallenge()) {
          const retryDelay = pickIntervalMs(challengeConfig.intervalRangeSeconds);
          queueNextChallenge(retryDelay);
        }
      } else {
        ensureNextChallengePreview({});
        scheduleChallengePulse(Math.max(50, challengeState.nextChallengeAt - nowTs));
      }
    } else {
      scheduleChallengePulse(null);
    }
  }, [governanceMedia, governedLabelSet, governanceConfig, activeParticipantNames, zoneRankMap, colorToZoneId, governancePulse, governancePhase, updateGovernancePhase, governancePolicies, userVitalsMap]);

  const isGovernedMedia = React.useMemo(() => {
    if (!governanceMedia || !governanceMedia.labels || !governanceMedia.labels.length) return false;
    return governanceMedia.labels.some((label) => governedLabelSet.has(label));
  }, [governanceMedia, governedLabelSet]);

  const deadlineMs = governanceMetaRef.current?.deadline;
  const governanceCountdownSeconds = (() => {
    if (!deadlineMs) return null;
    const msRemaining = deadlineMs - Date.now();
    if (!Number.isFinite(msRemaining) || msRemaining <= 0) return 0;
    return Math.max(0, Math.round(msRemaining / 1000));
  })();

  const governanceState = React.useMemo(() => {
    const summaryRef = governanceRequirementSummaryRef.current || {};
    const challengeState = governanceChallengeRef.current || {};
    const activeChallenge = challengeState.activeChallenge || null;
    const challengeSummary = activeChallenge?.summary || null;
    const statusIsGreen = governancePhase === 'green';
    const challengePaused = Boolean(
      (challengeSummary && challengeSummary.paused) ||
      (activeChallenge && activeChallenge.status === 'pending' && (!statusIsGreen || activeChallenge.pausedAt))
    );
    const challengeHistory = Array.isArray(challengeState.challengeHistory)
      ? challengeState.challengeHistory.slice(-10)
      : [];
    const nextChallengePreview = challengeState.nextChallenge || null;

    const pausedRemainingMs = challengePaused && Number.isFinite(activeChallenge?.pausedRemainingMs)
      ? Math.max(0, activeChallenge.pausedRemainingMs)
      : null;

    const challengeRemainingSeconds = (() => {
      if (challengePaused && pausedRemainingMs != null) {
        return Math.max(0, Math.ceil(pausedRemainingMs / 1000));
      }
      if (challengePaused && Number.isFinite(activeChallenge?.pausedAt) && Number.isFinite(activeChallenge?.expiresAt)) {
        return Math.max(0, Math.ceil((activeChallenge.expiresAt - activeChallenge.pausedAt) / 1000));
      }
      if (challengeSummary?.remainingSeconds != null) {
        return Math.max(0, challengeSummary.remainingSeconds);
      }
      if (activeChallenge?.status === 'pending' && Number.isFinite(activeChallenge?.expiresAt)) {
        return Math.max(0, Math.ceil((activeChallenge.expiresAt - Date.now()) / 1000));
      }
      return null;
    })();

    const challengeTotalSeconds = challengeSummary?.totalSeconds ?? (activeChallenge?.timeLimitSeconds ?? null);

    let nextChallengeSummary = null;
    if (nextChallengePreview) {
      const scheduledFor = Number.isFinite(challengeState.nextChallengeAt)
        ? challengeState.nextChallengeAt
        : Number.isFinite(challengeState.nextChallengeRemainingMs)
          ? Date.now() + challengeState.nextChallengeRemainingMs
          : nextChallengePreview.scheduledFor;
      if (Number.isFinite(scheduledFor)) {
        let remainingSeconds = null;
        if (statusIsGreen) {
          const remainingSecondsRaw = Math.ceil((scheduledFor - Date.now()) / 1000);
          remainingSeconds = Number.isFinite(remainingSecondsRaw)
            ? Math.max(0, remainingSecondsRaw)
            : null;
        } else if (Number.isFinite(challengeState.nextChallengeRemainingMs)) {
          remainingSeconds = Math.max(0, Math.ceil(challengeState.nextChallengeRemainingMs / 1000));
        }
        nextChallengeSummary = {
          selectionLabel: nextChallengePreview.selectionLabel || null,
          zone: nextChallengePreview.zone,
          rule: nextChallengePreview.rule,
          requiredCount: nextChallengePreview.requiredCount,
          timeLimitSeconds: nextChallengePreview.timeLimitSeconds ?? null,
          remainingSeconds,
          scheduledFor
        };
      }
    }

    const gracePeriodTotal = Number.isFinite(governanceMetaRef.current?.gracePeriodTotal)
      ? governanceMetaRef.current?.gracePeriodTotal
      : (Number.isFinite(governanceConfig?.grace_period_seconds) ? governanceConfig.grace_period_seconds : 30);

    return {
      isGoverned: isGovernedMedia,
      status: governancePhase || 'idle',
      labels: Array.isArray(governanceMedia?.labels) ? governanceMedia.labels : [],
      requirements: summaryRef.requirements || [],
      targetUserCount: summaryRef.targetUserCount,
      policyId: summaryRef.policyId || null,
      policyName: challengeState.activePolicyName || summaryRef.policyId || null,
      activeUserCount: summaryRef.activeCount,
      watchers: activeParticipantNames,
      countdownSecondsRemaining: governanceCountdownSeconds,
      gracePeriodTotal,
      videoLocked: Boolean(challengeState.videoLocked),
      challengePaused,
      challenge: activeChallenge
        ? {
            id: activeChallenge.id,
            status: activeChallenge.status,
            zone: challengeSummary?.zone || activeChallenge.zone,
            zoneLabel: challengeSummary?.zoneLabel || activeChallenge.zone,
            requiredCount: activeChallenge.requiredCount,
            actualCount: challengeSummary?.actualCount ?? null,
            metUsers: challengeSummary?.metUsers ?? [],
            missingUsers: challengeSummary?.missingUsers ?? [],
            remainingSeconds: challengeRemainingSeconds,
            totalSeconds: challengeTotalSeconds,
            startedAt: activeChallenge.startedAt,
            expiresAt: activeChallenge.expiresAt,
            selectionLabel: activeChallenge.selectionLabel || null,
            paused: challengePaused
          }
        : null,
      challengeHistory,
      challengeCountdownSeconds: challengeRemainingSeconds,
      challengeCountdownTotal: challengeTotalSeconds,
      nextChallenge: nextChallengeSummary
    };
  }, [isGovernedMedia, governancePhase, governanceMedia?.labels, activeParticipantNames, governanceCountdownSeconds, governancePulse, governanceConfig?.grace_period_seconds]);

  const triggerChallengeNow = React.useCallback((overridePayload = null) => {
    if (!governanceMedia?.id || !governanceState?.isGoverned) {
      return false;
    }
    const challengeState = governanceChallengeRef.current;
    challengeState.forceStartRequest = {
      requestedAt: Date.now(),
      payload: overridePayload && typeof overridePayload === 'object' ? { ...overridePayload } : null
    };
    setGovernancePulse((pulse) => pulse + 1);
    return true;
  }, [governanceMedia?.id, governanceState?.isGoverned]);
  
  // Context value
  const value = {
    connected,
    reconnectFitnessWebSocket,
    latestData,
    allDevices,
    deviceCount: fitnessDevices.size,
    lastUpdate,
  fitnessSession: fitnessSessionRef.current.summary,
  fitnessSessionInstance: fitnessSessionRef.current,
  voiceMemos,
  addVoiceMemoToSession,
  removeVoiceMemoFromSession,
  replaceVoiceMemoInSession,
    voiceMemoOverlay: voiceMemoOverlayState,
    openVoiceMemoReview,
    openVoiceMemoList,
    openVoiceMemoRedo,
    closeVoiceMemoOverlay,
    isSessionActive: fitnessSessionRef.current.isActive,
    treasureBox: fitnessSessionRef.current.treasureBox ? fitnessSessionRef.current.treasureBox.summary : null,
    
    // Play queue state
    fitnessPlayQueue,
    setFitnessPlayQueue,
    registerSessionScreenshot: (capture) => {
      try {
        fitnessSessionRef.current?.recordScreenshotCapture?.(capture);
      } catch (_) {}
    },
    configureSessionScreenshotPlan: (plan) => {
      try {
        fitnessSessionRef.current?.setScreenshotPlan?.(plan);
      } catch (_) {}
    },

    // Sidebar size mode controls
    sidebarSizeMode,
    setSidebarSizeMode,
    toggleSidebarSizeMode,
    mediaSwapActive,
    setMediaSwapActive,
    toggleMediaSwap,
    preferredMicrophoneId,
    setPreferredMicrophoneId,

    // User-related data
    users: allUsers,
    userCount: users.size,
    usersConfigRaw: effectiveUsersConfig,
    guestAssignments,
    assignGuestToDevice,
    clearGuestAssignment,
    suppressDeviceUntilNextReading,
    participantRoster,
    participantsByDevice: participantLookupByDevice,
    participantsByName: participantLookupByName,
    userVitals: userVitalsMap,
    getUserVitals,
    userZoneProgress,
    getUserZoneThreshold,
    userHeartRates: userHeartRateMap,
    getUserHeartRate,
    getDisplayLabel,
    replacedPrimaryPool,
    // Fallback logic: if config primary list is missing/empty but we DO have users, treat all as primary.
    // This ensures device->name mapping works even when upstream config shape failed to populate.
    primaryUsers: (usersConfig.primary && usersConfig.primary.length > 0)
      ? allUsers.filter(user => usersConfig.primary.some(config => config.name === user.name))
      : allUsers,
    // Secondary only if explicitly provided; otherwise empty to avoid accidental duplication
    secondaryUsers: (usersConfig.secondary && usersConfig.secondary.length > 0)
      ? allUsers.filter(user => usersConfig.secondary.some(config => config.name === user.name))
      : [],
    
    // Device configuration info
    deviceConfiguration: ant_devices,
    equipment: equipmentConfig,
    // Precomputed heart rate color map (stringified keys)
    hrColorMap: (() => {
      const map = {};
      try {
        const src = ant_devices?.hr || {};
        Object.keys(src).forEach(k => { map[String(k)] = src[k]; });
      } catch (_) {}
      return map;
    })(),
    
    // Plex configuration (for playlists, collections, etc.)
    plexConfig,
    nomusicLabels: normalizedNomusicLabels,
    musicEnabled,
    musicAutoEnabled,
    setMusicAutoEnabled,
    setMusicOverride: setMusicOverrideState,
    governanceConfig,
    governedLabels,
    governance: governancePhase,
    governanceState,
    setGovernanceMedia,
  triggerChallengeNow,
    
    // Categorized device arrays
    heartRateDevices,
    speedDevices,
    cadenceDevices,
    powerDevices,
    unknownDevices,

    // Zone / treasure data
    zones: zoneConfig || [],
    userCurrentZones: (() => {
      const tb = fitnessSessionRef.current.treasureBox;
      if (!tb) return {};
      const out = {};
      tb.perUser.forEach((val, key) => {
        if (!val) { out[key] = null; return; }
        // Accept currentColor or fallback to lastColor
        const color = val.currentColor || val.lastColor || null;
        let zoneId = val.zoneId || val.lastZoneId || null;
        // If zoneId missing but we have a color, resolve from globalZones
        if (!zoneId && color && tb.globalZones && tb.globalZones.length) {
          const match = tb.globalZones.find(z => String(z.color).toLowerCase() === String(color).toLowerCase());
          if (match) zoneId = match.id || match.name || null;
        }
        if (!color && !zoneId) { out[key] = null; return; }
        out[key] = { id: zoneId ? String(zoneId).toLowerCase() : null, color };
      });
      return out;
    })(),
    
    // Legacy compatibility - return the most recent heart rate device
    heartRate: heartRateDevices[0] || null,
    
    // Helper functions for user lookups
    getUserByName: (name) => users.get(name),
    getUserByDevice: (deviceId) => {
      if (deviceId == null) return undefined;
      const key = String(deviceId);
      const participant = participantLookupByDevice.get(key);
      if (participant) {
        if (!participant.isGuest) {
          const knownUser = users.get(participant.name);
          if (knownUser) {
            return knownUser;
          }
          return {
            name: participant.name,
            id: participant.profileId || participant.userId || slugifyId(participant.name),
            hrDeviceId: participant.hrDeviceId,
            profileId: participant.profileId || null,
            isGuest: false,
            baseUserName: participant.baseUserName || null,
            source: participant.source || 'Primary',
            zoneId: participant.zoneId || null,
            zoneColor: participant.zoneColor || null,
            heartRate: participant.heartRate ?? null,
            displayLabel: participant.displayLabel || getDisplayLabel(participant.name)
          };
        }
        return {
          name: participant.name,
          id: participant.profileId || participant.userId || slugifyId(participant.name),
          hrDeviceId: participant.hrDeviceId,
          profileId: participant.profileId || null,
          isGuest: true,
          baseUserName: participant.baseUserName || null,
          source: participant.source || 'Guest',
          zoneId: participant.zoneId || null,
          zoneColor: participant.zoneColor || null,
          heartRate: participant.heartRate ?? null,
          displayLabel: participant.displayLabel || resolveDisplayLabel({ name: participant.name })
        };
      }
      return allUsers.find(user =>
        String(user.hrDeviceId) === key ||
        String(user.cadenceDeviceId) === key
      );
    },
    
    // Playlist state
    selectedPlaylistId,
    setSelectedPlaylistId,
    
    // Video player pause state
    videoPlayerPaused,
    setVideoPlayerPaused,
    
    // Reset all user sessions
    resetAllUserSessions: () => {
      users.forEach(user => user.resetSession());
    }
  };

  return (
    <FitnessContext.Provider value={value}>
      {children}
    </FitnessContext.Provider>
  );
};