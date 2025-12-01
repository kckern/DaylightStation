import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  FitnessSession,
  setFitnessTimeouts,
  getFitnessTimeouts,
  resolveDisplayLabel,
  slugifyId,
  buildZoneConfig,
  deriveZoneProgressSnapshot,
  resolveZoneThreshold
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
  const [voiceMemoOverlayState, setVoiceMemoOverlayState] = useState(VOICE_MEMO_OVERLAY_INITIAL);
  const [voiceMemoVersion, setVoiceMemoVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const [internalPlayQueue, setInternalPlayQueue] = useState([]);
  const [preferredMicrophoneId, setPreferredMicrophoneId] = useState('');

  // Session State
  const fitnessSessionRef = useRef(new FitnessSession());
  const treasureConfigSignatureRef = useRef(null);
  const emptyRosterRef = useRef([]);
  const rosterCacheRef = useRef({ signature: null, value: emptyRosterRef.current });
  const [version, setVersion] = useState(0); // Trigger re-render
  const scheduledUpdateRef = useRef(false);

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
    governedLabels
  } = React.useMemo(() => {
    const root = fitnessConfiguration?.fitness ? fitnessConfiguration.fitness : fitnessConfiguration?.plex ? fitnessConfiguration : (fitnessConfiguration || {});
    const plex = root?.plex || {};
    const governance = root?.governance || {};
    const governanceLabelSource = Array.isArray(governance?.governed_labels) && governance.governed_labels.length > 0
      ? governance.governed_labels
      : plex?.governed_labels;
    const normalizedGovernedLabels = normalizeLabelList(governanceLabelSource);
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
        governed_labels: normalizedGovernedLabels
      },
      equipmentConfig: root?.equipment || [],
      nomusicLabels: normalizedNomusicLabels,
      governedLabels: normalizedGovernedLabels
    };
  }, [fitnessConfiguration]);

  // Derived Session State
  const session = fitnessSessionRef.current;
  const fitnessDevices = session.deviceManager.devices;
  const users = session.userManager.users;
  const guestAssignments = session.userManager.guestAssignments;
  
  // Legacy/Compatibility State
  const userGroupLabelMap = React.useMemo(() => new Map(), []);
  const lastUpdate = 0;
  const governancePulse = 0;
  const effectiveUsersConfig = usersConfig;
  const normalizedBaseZoneConfig = zoneConfig?.[0] || {};
  
  const primaryConfigByName = React.useMemo(() => {
      const map = new Map();
      if (Array.isArray(usersConfig?.primary)) {
          usersConfig.primary.forEach(u => { if(u?.name) map.set(u.name, u); });
      }
      return map;
  }, [usersConfig]);

  // Helper to force update (throttled to one microtask to avoid re-entrant loops)
  const forceUpdate = React.useCallback(() => {
    if (scheduledUpdateRef.current) return;
    scheduledUpdateRef.current = true;
    const scheduleFlush = typeof queueMicrotask === 'function'
      ? queueMicrotask
      : (cb) => Promise.resolve().then(cb);
    scheduleFlush(() => {
      scheduledUpdateRef.current = false;
      setVersion((v) => v + 1);
    });
  }, []);

  const configurationInputs = React.useMemo(() => {
    return {
      usersConfig,
      zoneConfig,
      governanceConfig,
      ant_devices,
      signature: JSON.stringify({ usersConfig, zoneConfig, governanceConfig, ant_devices })
    };
  }, [usersConfig, zoneConfig, governanceConfig, ant_devices]);

  const configuredSignatureRef = React.useRef(null);

  // Initialize Session Configuration
  useEffect(() => {
    const session = fitnessSessionRef.current;
    if (!session) return;

    const { usersConfig, zoneConfig, governanceConfig, ant_devices, signature } = configurationInputs;

    if (configuredSignatureRef.current === signature) {
      return;
    }
    configuredSignatureRef.current = signature;

    // Configure Timeouts
    const inactive = ant_devices?.timeout?.inactive;
    const remove = ant_devices?.timeout?.remove;
    setFitnessTimeouts({ inactive, remove });

    // Configure User Manager
    session.userManager.configure(usersConfig, zoneConfig);

    // Configure Governance
    session.governanceEngine.configure(governanceConfig);
    session.governanceEngine.setCallbacks({
      onPhaseChange: () => forceUpdate(),
      onPulse: () => forceUpdate()
    });

    // Configure TreasureBox (lazy init in session, but we can pre-config if needed)
    // Session handles lazy init, but we can push config now if session started.
    // Actually, session.ensureStarted() creates treasureBox.
    
    forceUpdate();
  }, [configurationInputs, forceUpdate]);

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

  // Sidebar toggle
  const toggleSidebarSizeMode = React.useCallback(() => {
    setSidebarSizeMode((m) => (m === 'regular' ? 'large' : 'regular'));
  }, []);


  // Guest Assignment
  const assignGuestToDevice = React.useCallback((deviceId, assignment) => {
    if (deviceId == null) return;
    const key = String(deviceId);
    const session = fitnessSessionRef.current;
    
    if (!assignment) {
      session.userManager.assignGuest(key, null);
    } else {
      const normalizedName = assignment.name || 'Guest';
      session.userManager.assignGuest(key, normalizedName, assignment);
    }
    forceUpdate();
  }, [forceUpdate]);

  const clearGuestAssignment = React.useCallback((deviceId) => {
    assignGuestToDevice(deviceId, null);
  }, [assignGuestToDevice]);

  const suppressDeviceUntilNextReading = React.useCallback((deviceId) => {
    if (deviceId == null) return false;

    const session = fitnessSessionRef.current;
    if (!session) return false;

    const rawId = String(deviceId);
    const slugId = slugifyId(deviceId);
    const candidateIds = Array.from(new Set([rawId, slugId].filter(Boolean)));

    let mutated = false;

    if (session.deviceManager?.removeDevice) {
      mutated = session.deviceManager.removeDevice(rawId) || mutated;
    } else if (session.deviceManager?.devices instanceof Map) {
      candidateIds.forEach((key) => {
        if (session.deviceManager.devices.delete(key)) {
          mutated = true;
        }
      });
    }

    const activeIds = session.activeDeviceIds;
    if (activeIds instanceof Set) {
      candidateIds.forEach((key) => {
        if (activeIds.delete(key)) {
          mutated = true;
        }
      });
    }

    const guestAssignmentsMap = session.userManager?.guestAssignments;
    if (guestAssignmentsMap instanceof Map) {
      candidateIds.forEach((key) => {
        if (guestAssignmentsMap.delete(key)) {
          mutated = true;
        }
      });
    }

    if (mutated) {
      forceUpdate();
    }

    return mutated;
  }, [forceUpdate]);

  // Voice Memos
  const voiceMemos = React.useMemo(() => {
    const raw = fitnessSessionRef.current?.voiceMemos;
    if (!Array.isArray(raw)) return [];
    return raw.map((memo) => ({ ...memo }));
  }, [voiceMemoVersion, version]); // Depend on version too

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

  // Lightweight heartbeat to refresh UI
  useEffect(() => {
    const interval = setInterval(() => {
      forceUpdate();
    }, 1000);
    return () => clearInterval(interval);
  }, [forceUpdate]);
  
  const fitnessPlayQueue = propPlayQueue !== undefined ? propPlayQueue : internalPlayQueue;
  const setFitnessPlayQueue = propSetPlayQueue || setInternalPlayQueue;
  
  // Governance Media Update
  const setGovernanceMedia = React.useCallback((input) => {
    const session = fitnessSessionRef.current;
    if (!session) return;
    
    const media = input ? { id: input.id, labels: normalizeLabelList(input.labels) } : null;
    session.governanceEngine.setMedia(media);
    forceUpdate();
  }, [forceUpdate]);

  const updateGovernancePhase = React.useCallback((nextPhase) => {
    // No-op, handled by engine callbacks
  }, []);
  
  
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000;

  const connectWebSocket = React.useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    const isLocalhost = /localhost/.test(window.location.href);
    const baseUrl = isLocalhost ? 'http://localhost:3112' : window.location.origin;
    const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';
    
    const ws = new window.WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const session = fitnessSessionRef.current;
        if (session) {
          session.ingestData(data);
          forceUpdate();
        }
      } catch (e) {
        // ignore
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          connectWebSocket();
        }, delay);
      }
    };

    ws.onerror = () => {
      setConnected(false);
    };
  }, [forceUpdate]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [connectWebSocket]);

  useEffect(() => {
    const interval = setInterval(() => {
      const { inactive, remove } = getFitnessTimeouts();
      const session = fitnessSessionRef.current;
      if (session) {
        session.deviceManager.pruneStaleDevices(remove);
        forceUpdate();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [forceUpdate]);

  const reconnectFitnessWebSocket = React.useCallback(() => {
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    reconnectAttemptsRef.current = 0;
    if (wsRef.current) wsRef.current.close();
    connectWebSocket();
  }, [connectWebSocket]);


  // Prepare data for context value
  const allDevices = React.useMemo(() => Array.from(fitnessDevices.values()), [fitnessDevices, version]);
  const allUsers = React.useMemo(() => Array.from(users.values()), [users, version]);
  
  // Categorized device arrays
  const heartRateDevices = React.useMemo(() => allDevices.filter(d => d.type === 'heart_rate'), [allDevices]);
  const speedDevices = React.useMemo(() => allDevices.filter(d => d.type === 'speed'), [allDevices]);
  const cadenceDevices = React.useMemo(() => allDevices.filter(d => d.type === 'cadence'), [allDevices]);
  const powerDevices = React.useMemo(() => allDevices.filter(d => d.type === 'power'), [allDevices]);
  const unknownDevices = React.useMemo(() => allDevices.filter(d => d.type === 'unknown'), [allDevices]);

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
        deviceId: entry?.deviceId || null,
        heartRate: Number.isFinite(entry?.heartRate) ? Math.round(entry.heartRate) : null,
        zoneId: entry?.zoneId || null,
        zoneColor: entry?.zoneColor || null
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

  const replacedPrimaryPool = React.useMemo(() => {
    if (!guestAssignments || primaryConfigByName.size === 0) return [];
    const seen = new Set();
    const pool = [];
    Array.from(guestAssignments.values()).forEach((assignment) => {
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
      const candidates = [
        entry.hrDeviceId,
        entry.deviceId,
        entry.device_id,
        entry.antDeviceId,
        entry.device?.id,
        entry.device?.deviceId
      ];
      candidates.forEach((key) => addKey(key, entry));
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
      if (!user || !user.name) return;
      const key = slugifyId(user.name);
      const data = user.currentData || {};
      
      const deviceId = user.hrDeviceId ? String(user.hrDeviceId) : null;
      const isGuest = deviceId && guestAssignments && guestAssignments[deviceId];
      const source = isGuest ? 'Guest' : 'Primary';
      const displayLabel = getDisplayLabel(user.name);

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
  }, [allUsers, guestAssignments, getDisplayLabel]);

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
    const session = fitnessSessionRef.current;
    const user = session?.userManager?.getUser(userName);
    const zoneProfile = user?.zoneConfig || normalizedBaseZoneConfig;
    return resolveZoneThreshold(zoneProfile, zoneId);
  }, [normalizedBaseZoneConfig]);

  // The session already owns the roster; avoid writing it back every render to prevent update loops.

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

  // Legacy governance logic removed (delegated to GovernanceEngine)

  // Governance State from Engine
  const governanceState = session?.governanceEngine?.state || { status: 'idle' };
  const governanceChallenge = session?.governanceEngine?.challengeState || {};
  const treasureBox = session?.treasureBox ? session.treasureBox.summary : null;

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
    
    connected,
    fitnessDevices,
    users,
    guestAssignments,
    
    allDevices,
    allUsers,
    heartRateDevices,
    speedDevices,
    cadenceDevices,
    powerDevices,
    unknownDevices,
    
    selectedPlaylistId,
    setSelectedPlaylistId,
    musicAutoEnabled,
    setMusicAutoEnabled,
    musicOverride,
    setMusicOverrideState,
    videoPlayerPaused,
    setVideoPlayerPaused,
    sidebarSizeMode,
    toggleSidebarSizeMode,
    voiceMemoOverlayState,
    
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
    openVoiceMemoRedo,
    
    setGovernanceMedia,
    updateGovernancePhase,
    governanceState,
    governanceChallenge,
    activeGovernancePolicy: session?.governanceEngine?.activePolicy,
    triggerChallengeNow,
    
    treasureBox,
    
    getDisplayLabel,
    zoneRankMap,
    colorToZoneId,
    zoneInfoMap,
    
    getDeviceUser: resolveUserByDevice,
    
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
    participantsByDevice: participantLookupByDevice,
    participantsByName: participantLookupByName,
    userVitals: userVitalsMap,
    getUserVitals,
    userZoneProgress,
    getUserZoneThreshold,
    userHeartRates: new Map(), // TODO
    getUserHeartRate,
    replacedPrimaryPool: [],
    primaryUsers: [],
    secondaryUsers: [],
    deviceConfiguration: ant_devices,
    equipment: equipmentConfig,
    hrColorMap: {},
    plexConfig,
    nomusicLabels,
    musicEnabled,
    setMusicOverride: setMusicOverrideState,
    governance: governanceState.status,
    zones: zoneConfig || [],
    userCurrentZones,
    heartRate: heartRateDevices[0] || null,
    getUserByName: (name) => users.get(name),
    getUserByDevice: resolveUserByDevice
  };

  return (
    <FitnessContext.Provider value={value}>
      {children}
    </FitnessContext.Provider>
  );
};