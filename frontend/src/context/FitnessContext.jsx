import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { User, DeviceFactory } from '../hooks/useFitnessWebSocket.js';

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

// Provider component
export const FitnessProvider = ({ children, fitnessConfiguration }) => {
  const ant_devices = fitnessConfiguration?.fitness?.ant_devices || {};
  const usersConfig = fitnessConfiguration?.fitness?.users || {};

  const [connected, setConnected] = useState(false);
  const [latestData, setLatestData] = useState(null);
  const [fitnessDevices, setFitnessDevices] = useState(new Map());
  const [users, setUsers] = useState(new Map());
  const [lastUpdate, setLastUpdate] = useState(null);
  
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000;
  
  // Use ref for device updates to prevent state management issues
  const deviceUpdateRef = useRef(null);

  // Initialize users from configuration - done only once
  useEffect(() => {
    if (!usersConfig) return;
    
    const userMap = new Map();
    
    // Process primary users
    if (usersConfig.primary) {
      usersConfig.primary.forEach(userConfig => {
        const user = new User(
          userConfig.name,
          userConfig.birthyear,
          userConfig.hr,
          userConfig.cadence
        );
        userMap.set(userConfig.name, user);
      });
    }

    // Process secondary users
    if (usersConfig.secondary) {
      usersConfig.secondary.forEach(userConfig => {
        const user = new User(
          userConfig.name,
          userConfig.birthyear,
          userConfig.hr,
          userConfig.cadence
        );
        userMap.set(userConfig.name, user);
      });
    }

    setUsers(userMap);
  }, []);  // Empty dependency array ensures this only runs once

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
            const profile = data.profile;
            const rawData = data.data;
            
            setFitnessDevices(prevDevices => {
              const newDevices = new Map(prevDevices);
              let device = newDevices.get(deviceId);

              if (device) {
                device.updateData({ ...rawData, dongleIndex: data.dongleIndex, timestamp: data.timestamp });
              } else {
                device = DeviceFactory.createDevice(deviceId, profile, { ...rawData, dongleIndex: data.dongleIndex, timestamp: data.timestamp });
              }
              
              // Store reference to updated device for user updates
              deviceUpdateRef.current = {
                deviceId,
                device: { ...device }
              };
              
              newDevices.set(deviceId, device);
              return newDevices;
            });
            
            // Update users in a separate effect to avoid nested state updates
            if (deviceUpdateRef.current) {
              const { deviceId, device } = deviceUpdateRef.current;
              
              setUsers(prevUsers => {
                const newUsers = new Map(prevUsers);
                let userUpdated = false;
                
                for (const [userName, user] of newUsers.entries()) {
                  if (String(user.hrDeviceId) === deviceId || String(user.cadenceDeviceId) === deviceId) {
                    user.updateFromDevice(device);
                    newUsers.set(userName, user);
                    userUpdated = true;
                  }
                }
                
                return userUpdated ? newUsers : prevUsers;
              });
              
              deviceUpdateRef.current = null;
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

  // Clean up inactive devices periodically
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = new Date();
      setFitnessDevices(prevDevices => {
        const newDevices = new Map(prevDevices);
        let hasChanges = false;
        
        for (const [deviceId, device] of newDevices.entries()) {
          const timeSinceLastSeen = now - device.lastSeen;
          // Mark as inactive after 60 seconds, remove after 3 minutes
          if (timeSinceLastSeen > 180000) { // 3 minutes
            newDevices.delete(deviceId);
            hasChanges = true;
          } else if (timeSinceLastSeen > 60000 && device.isActive) { // 60 seconds
            newDevices.set(deviceId, { ...device, isActive: false });
            hasChanges = true;
          }
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
    
    // User-related data
    users: allUsers,
    userCount: users.size,
    primaryUsers: allUsers.filter(user => 
      usersConfig.primary?.some(config => config.name === user.name)
    ),
    secondaryUsers: allUsers.filter(user => 
      usersConfig.secondary?.some(config => config.name === user.name)
    ),
    
    // Device configuration info
    deviceConfiguration: ant_devices,
    
    // Categorized device arrays
    heartRateDevices,
    speedDevices,
    cadenceDevices,
    powerDevices,
    unknownDevices,
    
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