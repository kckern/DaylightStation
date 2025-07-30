import React, { createContext, useContext, useState, useEffect } from 'react';

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

  // Function to register payload callbacks
  const registerPayloadCallback = (type, callback) => {
    setPayloadCallbacks(prev => new Map(prev.set(type, callback)));
  };

  // Function to unregister payload callbacks
  const unregisterPayloadCallback = (type) => {
    setPayloadCallbacks(prev => {
      const newMap = new Map(prev);
      newMap.delete(type);
      return newMap;
    });
  };

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
        
        // Handle payload messages only
        if (data.payload && data.type) {
          const callback = payloadCallbacks.get(data.type);
          if (callback && typeof callback === 'function') {
            callback(data.payload, data);
          } else {
            console.warn(`No callback registered for payload type: ${data.type}`);
          }
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
  }, [payloadCallbacks]);

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
