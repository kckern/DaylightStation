import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

const WebSocketContext = createContext();

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

export const WebSocketProvider = ({ children }) => {
  const [websocketConnected, setWebsocketConnected] = useState(false);
  const [messageReceived, setMessageReceived] = useState(false);
  
  // Use ref to store callback directly, no state needed
  const payloadCallbackRef = useRef(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000; // Start with 1 second

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
      
      console.log('Attempting to restart WebSocket server...');
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

  // Function to create WebSocket connection
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.CONNECTING) {
      console.log('WebSocket connection already in progress');
      return;
    }

    const isLocalhost = /localhost/.test(window.location.href);
    const baseUrl = isLocalhost ? 'http://localhost:3112' : window.location.origin;
    const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';
    
    console.log(`Connecting to WebSocket: ${wsUrl} (attempt ${reconnectAttemptsRef.current + 1})`);
    
    const ws = new window.WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected successfully');
      setWebsocketConnected(true);
      reconnectAttemptsRef.current = 0; // Reset attempts on successful connection
    };

    ws.onmessage = (event) => {
      // Flash yellow for 300ms when any message is received
      setMessageReceived(true);
      setTimeout(() => setMessageReceived(false), 300);
      
      try {
        const data = JSON.parse(event.data);
        
        // Call the callback with the raw data
        if (payloadCallbackRef.current && typeof payloadCallbackRef.current === 'function') {
          payloadCallbackRef.current(data);
        }
      } catch (e) {
        // ignore non-JSON or irrelevant messages
      }
    };

    ws.onclose = (event) => {
      console.log('WebSocket disconnected:', event.code, event.reason);
      setWebsocketConnected(false);
      wsRef.current = null;
      
      // Attempt to reconnect
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current), 30000); // Max 30 seconds
        console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          connectWebSocket();
        }, delay);
      } else {
        console.log('Max reconnection attempts reached. Trying to restart WebSocket server...');
        restartWebSocketServer().then((success) => {
          if (success) {
            // Wait a bit for server to restart, then try connecting again
            setTimeout(() => {
              reconnectAttemptsRef.current = 0; // Reset attempts after server restart
              connectWebSocket();
            }, 2000);
          } else {
            console.error('Failed to restart WebSocket server. Manual intervention may be required.');
          }
        });
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      setWebsocketConnected(false);
    };
  }, [restartWebSocketServer]);

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
  }, [connectWebSocket]);

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
