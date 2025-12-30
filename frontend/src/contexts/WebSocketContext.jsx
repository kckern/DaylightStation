import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { wsService } from '../services/WebSocketService';

const WebSocketContext = createContext();

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

/**
 * Predicate function to filter messages intended for OfficeApp
 * This whitelist approach ensures only relevant commands are processed.
 */
const isOfficeMessage = (msg) => {
  // BLACKLIST: Explicitly reject known non-office message types FIRST
  const BLOCKED_TOPICS = ['vibration', 'fitness', 'sensor', 'telemetry', 'logging'];
  if (msg.topic && BLOCKED_TOPICS.includes(msg.topic)) return false;
  
  const BLOCKED_SOURCES = ['mqtt', 'fitness', 'fitness-simulator', 'playback-logger'];
  if (msg.source && BLOCKED_SOURCES.includes(msg.source)) return false;
  
  // Reject sensor-like payloads
  if (msg.equipmentId || msg.deviceId || msg.data?.vibration !== undefined) return false;
  
  // WHITELIST: Explicit command messages
  if (msg.menu || msg.playback || msg.action) return true;
  // Content playback messages  
  if (msg.hymn || msg.scripture || msg.talk || msg.primary || msg.plex) return true;
  // Queue/play commands
  if (msg.play || msg.queue) return true;
  // Gratitude messages
  if (msg.type === 'gratitude_item' || msg.type === 'gratitude') return true;
  // Reject everything else (sensor telemetry, fitness data, etc.)
  return false;
};

export const WebSocketProvider = ({ children }) => {
  const [websocketConnected, setWebsocketConnected] = useState(false);
  const [messageReceived, setMessageReceived] = useState(false);
  
  // Use ref to store callback directly, no state needed
  const payloadCallbackRef = useRef(null);

  // Function to register payload callback
  const registerPayloadCallback = useCallback((callback) => {
    payloadCallbackRef.current = callback;
  }, []);

  // Function to unregister payload callback
  const unregisterPayloadCallback = useCallback(() => {
    payloadCallbackRef.current = null;
  }, []);

  // Function to restart WebSocket server as last resort
  const restartWebSocketServer = useCallback(async () => {
    try {
      const isLocalhost = /localhost/.test(window.location.href);
      const baseUrl = isLocalhost ? 'http://localhost:3112' : window.location.origin;
      
      const response = await fetch(`${baseUrl}/exe/ws/restart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('WebSocket server restart successful:', result);
        return true;
      } else {
        console.error('WebSocket server restart failed:', response.status);
        return false;
      }
    } catch (error) {
      console.error('Error restarting WebSocket server:', error);
      return false;
    }
  }, []);

  // Subscribe to WebSocket using centralized service
  useEffect(() => {
    // Subscribe to connection status changes
    const unsubscribeStatus = wsService.onStatusChange(({ connected }) => {
      setWebsocketConnected(connected);
    });

    // Subscribe to messages using the OfficeApp whitelist filter
    const unsubscribeMessages = wsService.subscribe(
      isOfficeMessage,
      (data) => {
        // Flash indicator for 300ms when message is received
        setMessageReceived(true);
        setTimeout(() => setMessageReceived(false), 300);

        // Call the registered callback
        if (payloadCallbackRef.current && typeof payloadCallbackRef.current === 'function') {
          payloadCallbackRef.current(data);
        }
      }
    );

    return () => {
      unsubscribeStatus();
      unsubscribeMessages();
    };
  }, []);

  const value = {
    websocketConnected,
    messageReceived,
    registerPayloadCallback,
    unregisterPayloadCallback,
    restartWebSocketServer
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
};
