import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { User, DeviceFactory, setFitnessTimeouts, getFitnessTimeouts, FitnessSession } from '../hooks/useFitnessWebSocket.js';

// Create context
const FitnessContext = createContext(null);

const normalizeLabelList = (raw) => {
  if (!Array.isArray(raw)) return [];
  const normalized = raw
    .map(label => (typeof label === 'string' ? label.trim().toLowerCase() : ''))
    .filter(Boolean);
  return Array.from(new Set(normalized));
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
  const [videoPlayerPaused, setVideoPlayerPaused] = useState(false);
  // Accept either shape: { fitness: {...} } or flattened keys directly
  const fitnessRoot = fitnessConfiguration?.fitness ? fitnessConfiguration.fitness : fitnessConfiguration?.plex ? fitnessConfiguration : (fitnessConfiguration || {});
  if (FITNESS_DEBUG) {
    try {
      console.log('[FitnessContext][PROP] top-level keys:', Object.keys(fitnessConfiguration||{}));
      console.log('[FitnessContext][PROP] resolved fitnessRoot keys:', Object.keys(fitnessRoot||{}));
    } catch(_) {}
  }
  const ant_devices = fitnessRoot?.ant_devices || {};
  let usersConfig = fitnessRoot?.users || {};
  if (FITNESS_DEBUG && (!usersConfig.primary || usersConfig.primary.length === 0)) {
    console.warn('[FitnessContext][WARN] usersConfig.primary empty (resolved).');
  }
  const equipmentConfig = fitnessRoot?.equipment || [];
  const coinTimeUnitMs = fitnessRoot?.coin_time_unit_ms;
  const zoneConfig = fitnessRoot?.zones;
  const governanceConfig = fitnessRoot?.governance || {};
  console.log('[FitnessContext] governanceConfig loaded:', governanceConfig);
  console.log('[FitnessContext] governanceConfig.user_counts:', governanceConfig?.user_counts);
  const rawGovernedLabels = fitnessRoot?.plex?.governed_labels;
  const governedLabels = Array.isArray(rawGovernedLabels)
    ? rawGovernedLabels.filter(label => typeof label === 'string')
    : [];

  const [connected, setConnected] = useState(false);
  const [latestData, setLatestData] = useState(null);
  const [fitnessDevices, setFitnessDevices] = useState(new Map());
  const [users, setUsers] = useState(new Map());
  const [lastUpdate, setLastUpdate] = useState(null);
  const [internalPlayQueue, setInternalPlayQueue] = useState([]);
  const [governancePhase, setGovernancePhase] = useState(null); // null | 'init' | 'green' | 'yellow' | 'red'
  const [governanceMedia, setGovernanceMediaState] = useState(null);
  const [governancePulse, setGovernancePulse] = useState(0);
  const governanceMetaRef = useRef({ mediaId: null, satisfiedOnce: false, deadline: null });
  const governanceTimerRef = useRef(null);
  const governanceRequirementSummaryRef = useRef({ targetUserCount: null, requirements: [], activeCount: 0 });
  const [, forceVersion] = useState(0); // used to force re-render on treasure box coin mutation
  const scheduledUpdateRef = useRef(false); // debounce for mutation callback

  // Sidebar size mode: 'regular' | 'large'
  const [sidebarSizeMode, setSidebarSizeMode] = useState('regular');
  const toggleSidebarSizeMode = React.useCallback(() => {
    setSidebarSizeMode((m) => (m === 'regular' ? 'large' : 'regular'));
  }, []);

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
      governanceMetaRef.current = { mediaId, satisfiedOnce: false, deadline: null };
      updateGovernancePhase(null);
    }
  }, [governanceMedia?.id, updateGovernancePhase]);

  useEffect(() => () => {
    if (governanceTimerRef.current) {
      clearTimeout(governanceTimerRef.current);
      governanceTimerRef.current = null;
    }
  }, []);
  
  
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000;
  
  // Use ref for device updates to prevent state management issues
  const deviceUpdateRef = useRef(null);
  // Session ref
  const fitnessSessionRef = useRef(new FitnessSession());
  // Keep a ref mirror of users map to avoid stale closures inside ws handlers
  const usersRef = useRef(users);
  useEffect(() => { usersRef.current = users; }, [users]);
  useEffect(() => {
    if (FITNESS_DEBUG) {
      console.log('[FitnessContext][USERS_REF] Updated usersRef size=', usersRef.current.size);
      usersRef.current.forEach(u => console.log('[FitnessContext][USERS_REF] user', { name: u.name, hr: u.hrDeviceId, cadence: u.cadenceDeviceId, id: u.id }));
    }
  }, [users]);
  // Fast lookup map (hr device id -> user object)
  const hrDeviceUserMapRef = useRef(new Map());
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
        const user = new User(userConfig.name, userConfig.birthyear, userConfig.hr, userConfig.cadence);
        if (userConfig.id) user.id = userConfig.id;
        userMap.set(userConfig.name, user);
      });
    }
    if (usersConfig.secondary) {
      usersConfig.secondary.forEach(userConfig => {
        const user = new User(userConfig.name, userConfig.birthyear, userConfig.hr, userConfig.cadence);
        if (userConfig.id) user.id = userConfig.id;
        userMap.set(userConfig.name, user);
      });
    }
    if (FITNESS_DEBUG) {
      console.log('[FitnessContext][INIT] Users (re)built from config');
      console.table(Array.from(userMap.values()).map(u => ({ name: u.name, hr: u.hrDeviceId, cadence: u.cadenceDeviceId, id: u.id })));
    }
    setUsers(userMap);
  }, [usersConfig]);

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
                  const matches = [];
                  usersRef.current.forEach((userObj) => {
                    if (String(userObj.hrDeviceId) === String(device.deviceId)) {
                      matches.push(userObj.name);
                      fitnessSessionRef.current.treasureBox.recordUserHeartRate(userObj.name, device.heartRate);
                    }
                  });
                  if (FITNESS_DEBUG) {
                    console.log('[FitnessContext][WS] HR scan mapping', { deviceId, matches, hr: device.heartRate });
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
        users: usersConfig
      });
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
  }, [coinTimeUnitMs, zoneConfig, usersConfig, fitnessDevices, users]);

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

  const activeParticipantNames = React.useMemo(() => {
    if (!heartRateDevices.length) return [];
    const deviceToUser = new Map();
    users.forEach((user) => {
      if (user?.hrDeviceId != null) {
        deviceToUser.set(String(user.hrDeviceId), user.name);
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
  }, [heartRateDevices, users]);

  useEffect(() => {
    if (governanceTimerRef.current) {
      clearTimeout(governanceTimerRef.current);
      governanceTimerRef.current = null;
    }

    const media = governanceMedia;
    const setRequirementSummary = (targetCount, requirements) => {
      governanceRequirementSummaryRef.current = {
        targetUserCount: targetCount != null ? targetCount : null,
        requirements: Array.isArray(requirements) ? requirements : [],
        activeCount: activeParticipantNames.length
      };
    };

    if (!media || !media.id) {
      updateGovernancePhase(null);
      setRequirementSummary(null, []);
      return;
    }

    if (!governedLabelSet.size) {
      updateGovernancePhase(null);
      setRequirementSummary(null, []);
      return;
    }

    const hasGovernedLabel = media.labels.some((label) => governedLabelSet.has(label));
    if (!hasGovernedLabel) {
      updateGovernancePhase(null);
      setRequirementSummary(null, []);
      return;
    }

    if (activeParticipantNames.length === 0) {
      governanceMetaRef.current.satisfiedOnce = false;
      governanceMetaRef.current.deadline = null;
      updateGovernancePhase('init');
      setRequirementSummary(null, []);
      return;
    }

    const requirementSource = governanceConfig?.user_counts || {};
    const activeUserCount = activeParticipantNames.length;
    console.log('[Governance] Requirement source:', requirementSource);
    console.log('[Governance] Active user count:', activeUserCount);
    const sortedCounts = Object.keys(requirementSource)
      .map((key) => Number(key))
      .filter((num) => Number.isFinite(num))
      .sort((a, b) => a - b);
    console.log('[Governance] Sorted counts:', sortedCounts);
    let matchedCount = null;
    for (const count of sortedCounts) {
      if (activeUserCount >= count) {
        matchedCount = count;
      }
    }
    if (matchedCount == null && sortedCounts.length > 0) {
      matchedCount = sortedCounts[0];
    }
    console.log('[Governance] Final matched count:', matchedCount);
    const requirementDefinition = matchedCount != null ? requirementSource[String(matchedCount)] : null;
    console.log('[Governance] Looking up requirementSource[' + String(matchedCount) + ']:', requirementDefinition);

    const defaultGrace = Number.isFinite(governanceConfig?.grace_period_seconds)
      ? governanceConfig.grace_period_seconds
      : 0;

    const computeUserZones = () => {
      const tb = fitnessSessionRef.current?.treasureBox;
      if (!tb || !tb.perUser) return {};
      const result = {};
      try {
        tb.perUser.forEach((val, key) => {
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
      return result;
    };

    const userZoneMap = computeUserZones();
    const deriveZoneId = (name) => userZoneMap[name] || null;

    console.log('[Governance] User zones:', userZoneMap);
    console.log('[Governance] Active participants:', activeParticipantNames);
    console.log('[Governance] Zone rank map:', zoneRankMap);
    console.log('[Governance] Requirement definition:', requirementDefinition);
    console.log('[Governance] Matched count:', matchedCount);

    if (!requirementDefinition || typeof requirementDefinition !== 'object') {
      console.error('[Governance] ERROR: No requirement definition found! Config may not be loaded.');
      // Set to init (grey) with error - NEVER default to green
      governanceMetaRef.current.satisfiedOnce = false;
      governanceMetaRef.current.deadline = null;
      updateGovernancePhase('init');
      setRequirementSummary(matchedCount, []);
      return;
    }

    const requirementEntries = Object.entries(requirementDefinition).filter(([key]) => key !== 'grace_period_seconds');

    if (!requirementEntries.length) {
      console.error('[Governance] ERROR: No requirement entries found!');
      // Set to init (grey) - NEVER default to green without requirements
      governanceMetaRef.current.satisfiedOnce = false;
      governanceMetaRef.current.deadline = null;
      updateGovernancePhase('init');
      setRequirementSummary(matchedCount, []);
      return;
    }

    const totalCount = activeParticipantNames.length;
    const requirementSummaries = [];

    const normalizeRequiredCount = (rule) => {
      if (typeof rule === 'number') {
        return Math.min(Math.max(0, rule), totalCount);
      }
      switch (rule) {
        case 'all':
          return totalCount;
        case 'majority':
          return Math.max(1, Math.ceil(totalCount * 0.6));
        case 'some':
          return Math.max(1, Math.ceil(totalCount * 0.5));
        case 'any':
          return 1;
        default:
          return totalCount;
      }
    };

    const describeRule = (rule, requiredCount) => {
      if (typeof rule === 'number') {
        return `${requiredCount} participant${requiredCount === 1 ? '' : 's'}`;
      }
      switch (rule) {
        case 'all':
          return 'All participants';
        case 'majority':
          return `Majority (${requiredCount})`;
        case 'some':
          return `Some (${requiredCount})`;
        case 'any':
          return 'Any participant';
        default:
          return String(rule);
      }
    };

    const evaluateRequirement = (zoneKey, rule) => {
      const zoneId = zoneKey ? String(zoneKey).toLowerCase() : null;
      if (!zoneId) return false;
      const requiredRank = zoneRankMap[zoneId];
      if (!Number.isFinite(requiredRank)) return false;

      const metUsers = [];
      activeParticipantNames.forEach((name) => {
        const participantZoneId = deriveZoneId(name);
        // If no zone, treat as rank 0 (cool zone)
        const participantRank = participantZoneId && Number.isFinite(zoneRankMap[participantZoneId]) 
          ? zoneRankMap[participantZoneId] 
          : 0;
        
        if (participantRank >= requiredRank) {
          metUsers.push(name);
        }
      });

      const requiredCount = normalizeRequiredCount(rule);
      const satisfied = metUsers.length >= requiredCount;
      const missingUsers = activeParticipantNames.filter((name) => !metUsers.includes(name));
      const zoneInfo = zoneInfoMap[zoneId];

      requirementSummaries.push({
        zone: zoneId,
        zoneLabel: zoneInfo?.name || zoneId,
        rule,
        ruleLabel: describeRule(rule, requiredCount),
        requiredCount,
        actualCount: metUsers.length,
        metUsers,
        missingUsers,
        satisfied
      });

      return satisfied;
    };

    const allSatisfied = requirementEntries.every(([zoneKey, rule]) => evaluateRequirement(zoneKey, rule));

    setRequirementSummary(matchedCount, requirementSummaries);

    console.log('[Governance] Evaluation result:', {
      requirementEntries,
      requirementSummaries,
      allSatisfied,
      satisfiedOnce: governanceMetaRef.current.satisfiedOnce
    });

    if (allSatisfied) {
      governanceMetaRef.current.satisfiedOnce = true;
      governanceMetaRef.current.deadline = null;
      updateGovernancePhase('green');
      return;
    }

    if (!governanceMetaRef.current.satisfiedOnce) {
      governanceMetaRef.current.deadline = null;
      updateGovernancePhase('init');
      return;
    }

    let graceSeconds = defaultGrace;
    if (Number.isFinite(requirementDefinition.grace_period_seconds)) {
      graceSeconds = requirementDefinition.grace_period_seconds;
    }

    if (!Number.isFinite(graceSeconds) || graceSeconds <= 0) {
      governanceMetaRef.current.deadline = null;
      governanceMetaRef.current.gracePeriodTotal = null;
      updateGovernancePhase('red');
      return;
    }

    if (!governanceMetaRef.current.deadline) {
      governanceMetaRef.current.deadline = Date.now() + graceSeconds * 1000;
      governanceMetaRef.current.gracePeriodTotal = graceSeconds;
    }

    const remainingMs = governanceMetaRef.current.deadline - Date.now();

    if (remainingMs <= 0) {
      // Grace period expired - stay in red, don't restart the timer
      governanceMetaRef.current.gracePeriodTotal = null;
      updateGovernancePhase('red');
      return;
    }

    governanceTimerRef.current = setTimeout(() => {
      setGovernancePulse((pulse) => pulse + 1);
    }, remainingMs);

    updateGovernancePhase('yellow');
  }, [governanceMedia, governedLabelSet, governanceConfig, activeParticipantNames, zoneRankMap, colorToZoneId, governancePulse, updateGovernancePhase]);

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

  const governanceState = React.useMemo(() => ({
    isGoverned: isGovernedMedia,
    status: governancePhase || 'idle',
    labels: Array.isArray(governanceMedia?.labels) ? governanceMedia.labels : [],
    requirements: governanceRequirementSummaryRef.current.requirements || [],
    targetUserCount: governanceRequirementSummaryRef.current.targetUserCount,
    activeUserCount: governanceRequirementSummaryRef.current.activeCount,
    watchers: activeParticipantNames,
    countdownSecondsRemaining: governanceCountdownSeconds,
    gracePeriodTotal: governanceMetaRef.current?.gracePeriodTotal || 30
  }), [isGovernedMedia, governancePhase, governanceMedia?.labels, activeParticipantNames, governanceCountdownSeconds, governancePulse]);
  
  // Context value
  const value = {
    connected,
    reconnectFitnessWebSocket,
    latestData,
    allDevices,
    deviceCount: fitnessDevices.size,
    lastUpdate,
    fitnessSession: fitnessSessionRef.current.summary,
    isSessionActive: fitnessSessionRef.current.isActive,
    treasureBox: fitnessSessionRef.current.treasureBox ? fitnessSessionRef.current.treasureBox.summary : null,
    
    // Play queue state
    fitnessPlayQueue,
    setFitnessPlayQueue,

  // Sidebar size mode controls
  sidebarSizeMode,
  setSidebarSizeMode,
  toggleSidebarSizeMode,
    
    // User-related data
    users: allUsers,
    userCount: users.size,
  usersConfigRaw: usersConfig,
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
    plexConfig: fitnessRoot?.plex || {},
    governanceConfig,
    governedLabels,
    governance: governancePhase,
  governanceState,
    setGovernanceMedia,
    
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
    getUserByDevice: (deviceId) => allUsers.find(user => 
      String(user.hrDeviceId) === String(deviceId) || 
      String(user.cadenceDeviceId) === String(deviceId)
    ),
    
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