import { useState, useEffect, useRef } from 'react';

/**
 * Custom hook for listening to fitness-specific WebSocket messages
 * Connects to the same /ws endpoint but only processes fitness topic messages
 */
export const useFitnessWebSocket = () => {
  const [connected, setConnected] = useState(false);
  const [latestData, setLatestData] = useState(null);
  const [heartRateDevices, setHeartRateDevices] = useState(new Map());
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
      console.log('Fitness WebSocket connected successfully');
      setConnected(true);
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Only process fitness messages
        if (data.topic === 'fitness') {
          console.log('📊 Fitness WebSocket received:', data);
          console.log('📊 Message keys:', Object.keys(data));
          setLatestData(data);
          setLastUpdate(new Date());
          
          // Extract heart rate data specifically - check all possible field names
          if (data.type === 'heart_rate' && data.deviceId) {
            const heartRateValue = data.heartRate || data.bpm || data.ComputedHeartRate || data.value;
            
            console.log(`💓 Processing device ${data.deviceId}: heartRate=${heartRateValue}`);
            
            if (heartRateValue !== undefined && heartRateValue !== null) {
              const deviceId = String(data.deviceId);
              
              console.log(`✅ Adding/updating device ${deviceId} with BPM: ${heartRateValue}`);
              
              setHeartRateDevices(prevDevices => {
                const newDevices = new Map(prevDevices);
                newDevices.set(deviceId, {
                  deviceId: deviceId,
                  value: heartRateValue,
                  timestamp: data.timestamp,
                  batteryLevel: data.batteryLevel,
                  heartBeatCount: data.heartBeatCount,
                  lastSeen: new Date(),
                  isActive: true
                });
                console.log(`📊 Device map now has ${newDevices.size} devices:`, Array.from(newDevices.keys()));
                return newDevices;
              });
            } else {
              console.log('⚠️ Heart rate message missing BPM value:', data);
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
      setHeartRateDevices(prevDevices => {
        const newDevices = new Map(prevDevices);
        let hasChanges = false;
        
        for (const [deviceId, device] of newDevices.entries()) {
          const timeSinceLastSeen = now - device.lastSeen;
          // Mark as inactive after 30 seconds, remove after 5 minutes
          if (timeSinceLastSeen > 300000) { // 5 minutes
            newDevices.delete(deviceId);
            hasChanges = true;
          } else if (timeSinceLastSeen > 30000 && device.isActive) { // 30 seconds
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

  return {
    connected,
    latestData,
    heartRateDevices: Array.from(heartRateDevices.values()),
    deviceCount: heartRateDevices.size,
    lastUpdate,
    // Legacy compatibility - return the most recent device
    heartRate: heartRateDevices.size > 0 ? Array.from(heartRateDevices.values())[0] : null
  };
};
