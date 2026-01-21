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
 * Topics intended for OfficeApp
 */
const OFFICE_TOPICS = ['playback', 'menu', 'system', 'gratitude'];

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

    // Subscribe to messages using the OfficeApp topic list
    const unsubscribeMessages = wsService.subscribe(
      OFFICE_TOPICS,
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
