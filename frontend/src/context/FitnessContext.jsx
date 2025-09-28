import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { User, DeviceFactory, setFitnessTimeouts, getFitnessTimeouts, FitnessSession } from '../hooks/useFitnessWebSocket.js';

// Create context
const FitnessContext = createContext(null);

// Custom hook for using the context
export const useFitnessContext = () => {
  const context = useContext(FitnessContext);
  if (!context) {
    throw new Error('useFitnessContext must be used within a FitnessProvider');
  }
  return context;
};

// Alias for compatibility
export const useFitness = useFitnessContext;

// Provider component
export const FitnessProvider = ({ children, fitnessConfiguration, fitnessPlayQueue: propPlayQueue, setFitnessPlayQueue: propSetPlayQueue }) => {
  const FITNESS_DEBUG = false; // set false to silence diagnostic logs
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

  const [connected, setConnected] = useState(false);
  const [latestData, setLatestData] = useState(null);
  const [fitnessDevices, setFitnessDevices] = useState(new Map());
  const [users, setUsers] = useState(new Map());
  const [lastUpdate, setLastUpdate] = useState(null);
  const [internalPlayQueue, setInternalPlayQueue] = useState([]);
  
  // Use the provided queue state from props if available, otherwise use internal state
  const fitnessPlayQueue = propPlayQueue !== undefined ? propPlayQueue : internalPlayQueue;
  const setFitnessPlayQueue = propSetPlayQueue || setInternalPlayQueue;
  
  console.log('🎬 FitnessProvider: Queue state:', { 
    props: propPlayQueue, 
    internal: internalPlayQueue, 
    resolved: fitnessPlayQueue,
    hasPropSetter: !!propSetPlayQueue
  });
  
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
        console.debug('Fitness WebSocket: Non-JSON message received');
      }
    };

    ws.onclose = (event) => {
      console.log('Fitness WebSocket disconnected:', event.code, event.reason);
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
    }
  }, [coinTimeUnitMs, zoneConfig, usersConfig]);

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
  
  // Context value
  const value = {
    connected,
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
        // currentColor already tracked; derive zone by matching global zone color if needed
        out[key] = val.currentColor || null;
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