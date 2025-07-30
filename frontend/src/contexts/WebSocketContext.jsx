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
  const [payloadCallbacks, setPayloadCallbacks] = useState(new Map());
  
  // Use ref to access current callbacks in onmessage handler
  const payloadCallbacksRef = useRef(payloadCallbacks);

  // Function to register payload callbacks
  const registerPayloadCallback = useCallback((type, callback) => {
    setPayloadCallbacks(prev => {
      const newMap = new Map(prev);
      newMap.set(type, callback);
      payloadCallbacksRef.current = newMap;
      return newMap;
    });
  }, []);

  // Function to unregister payload callbacks
  const unregisterPayloadCallback = useCallback((type) => {
    setPayloadCallbacks(prev => {
      const newMap = new Map(prev);
      newMap.delete(type);
      payloadCallbacksRef.current = newMap;
      return newMap;
    });
  }, []);

  useEffect(() => {
    // Use window.location for host/port, ws protocol
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsHost = window.location.hostname;
    const wsPort = 3112;
    const wsUrl = `${wsProtocol}://${wsHost}:${wsPort}/ws/nav`;
    const ws = new window.WebSocket(wsUrl);

    ws.onopen = () => {
      setWebsocketConnected(true);
    };

    ws.onmessage = (event) => {
      // Flash yellow for 300ms when any message is received
      setMessageReceived(true);
      setTimeout(() => setMessageReceived(false), 300);
      
      try {
        const data = JSON.parse(event.data);
        
        // Call the wildcard callback with the raw data
        const wildcardCallback = payloadCallbacksRef.current.get('*');
        if (wildcardCallback && typeof wildcardCallback === 'function') {
          wildcardCallback(data);
        } else {
          console.warn('No wildcard callback registered for WebSocket messages');
        }
      } catch (e) {
        // ignore non-JSON or irrelevant messages
      }
    };

    ws.onclose = () => {
      setWebsocketConnected(false);
    };

    ws.onerror = (err) => {
      setWebsocketConnected(false);
    };

    return () => {
      ws.close();
    };
  }, []); // Remove payloadCallbacks from dependencies to prevent reconnections

  const value = {
    websocketConnected,
    messageReceived,
    registerPayloadCallback,
    unregisterPayloadCallback
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
};
