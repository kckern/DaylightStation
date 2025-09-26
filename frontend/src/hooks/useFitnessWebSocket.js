import { useState, useEffect, useRef } from 'react';

/**
 *Custom hook for listening to fitness-specific WebSocket messages
 * Connects to the same /ws endpoint but only processes fitness topic messages
 */
export const useFitnessWebSocket = () => {
  const [connected, setConnected] = useState(false);
  const [latestData, setLatestData] = useState(null);
  const [fitnessDevices, setFitnessDevices] = useState(new Map());
  const [lastUpdate, setLastUpdate] = useState(null);
  
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000;

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
            
            console.log(`� Processing ${profile} device ${deviceId}:`, rawData);
            
            // Extract metrics based on profile type
            let deviceInfo = {
              deviceId,
              profile,
              dongleIndex: data.dongleIndex,
              timestamp: data.timestamp,
              lastSeen: new Date(),
              isActive: true,
              batteryLevel: rawData.BatteryLevel,
              batteryVoltage: rawData.BatteryVoltage,
              serialNumber: rawData.SerialNumber,
              manufacturerId: rawData.ManId
            };
            
            // Add profile-specific metrics
            if (profile === 'HR' || profile === 'HeartRate') {
              deviceInfo.type = 'heart_rate';
              deviceInfo.heartRate = rawData.ComputedHeartRate;
              deviceInfo.beatCount = rawData.BeatCount;
              deviceInfo.beatTime = rawData.BeatTime;
            } else if (profile === 'SPD' || profile === 'Speed') {
              deviceInfo.type = 'speed';
              deviceInfo.speed = rawData.CalculatedSpeed; // m/s
              deviceInfo.speedKmh = rawData.CalculatedSpeed ? (rawData.CalculatedSpeed * 3.6) : null;
              deviceInfo.distance = rawData.CalculatedDistance;
              deviceInfo.revolutionCount = rawData.CumulativeSpeedRevolutionCount;
              deviceInfo.eventTime = rawData.SpeedEventTime;
            } else if (profile === 'CAD' || profile === 'Cadence') {
              deviceInfo.type = 'cadence';
              deviceInfo.cadence = rawData.CalculatedCadence;
              deviceInfo.revolutionCount = rawData.CumulativeCadenceRevolutionCount;
              deviceInfo.eventTime = rawData.CadenceEventTime;
            } else if (profile === 'PWR' || profile === 'Power') {
              deviceInfo.type = 'power';
              deviceInfo.power = rawData.InstantaneousPower;
              deviceInfo.cadence = rawData.Cadence;
              deviceInfo.pedalPowerBalance = rawData.PedalPowerBalance;
            } else {
              deviceInfo.type = 'unknown';
              deviceInfo.rawData = rawData;
            }
            
            setFitnessDevices(prevDevices => {
              const newDevices = new Map(prevDevices);
              newDevices.set(deviceId, deviceInfo);

              return newDevices;
            });
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
    }, 10000); // Check every 10 seconds

    return () => clearInterval(cleanupInterval);
  }, []);

  useEffect(() => {
    connectWebSocket();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const allDevices = Array.from(fitnessDevices.values());
  
  return {
    connected,
    latestData,
    allDevices,
    deviceCount: fitnessDevices.size,
    lastUpdate,
    // Categorized device arrays
    heartRateDevices: allDevices.filter(d => d.type === 'heart_rate'),
    speedDevices: allDevices.filter(d => d.type === 'speed'),
    cadenceDevices: allDevices.filter(d => d.type === 'cadence'),
    powerDevices: allDevices.filter(d => d.type === 'power'),
    unknownDevices: allDevices.filter(d => d.type === 'unknown'),
    // Legacy compatibility - return the most recent heart rate device
    heartRate: allDevices.find(d => d.type === 'heart_rate') || null
  };
};
