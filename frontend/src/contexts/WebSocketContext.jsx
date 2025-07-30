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

  // Function to register payload callback
  const registerPayloadCallback = useCallback((callback) => {
    payloadCallbackRef.current = callback;
  }, []);

  // Function to unregister payload callback
  const unregisterPayloadCallback = useCallback(() => {
    payloadCallbackRef.current = null;
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
      
      // Log any message that comes through
    //  console.log('WebSocket message received:', event.data);
      
      try {
        const data = JSON.parse(event.data);
      //  console.log('Parsed WebSocket data:', data);
        
        // Call the callback with the raw data
        if (payloadCallbackRef.current && typeof payloadCallbackRef.current === 'function') {
          payloadCallbackRef.current(data);
        }
      } catch (e) {
    //    console.log('WebSocket message was not JSON or failed to parse:', e);
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
