import React from 'react';
import { useWebSocket } from '../../contexts/WebSocketContext.jsx';

const ConnectionStatus = ({ size = 12 }) => {
  const { websocketConnected, messageReceived } = useWebSocket();

  // Determine color based on state priority: yellow flash > connected green > disconnected red
  let backgroundColor, boxShadow;
  
  if (messageReceived) {
    backgroundColor = '#ffff00'; // Yellow when message received
    boxShadow = '0 0 8px rgba(255, 255, 0, 0.8)';
  } else if (websocketConnected) {
    backgroundColor = '#00ff00'; // Green when connected
    boxShadow = '0 0 6px rgba(0, 255, 0, 0.6)';
  } else {
    backgroundColor = '#ff0000'; // Red when disconnected
    boxShadow = '0 0 6px rgba(255, 0, 0, 0.6)';
  }

  const dotStyle = {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    backgroundColor,
    boxShadow,
    display: 'inline-block',
    transition: messageReceived ? 'none' : 'all 0.3s ease' // No transition during flash
  };

  const getTooltipText = () => {
    if (messageReceived) return 'Message Received';
    return websocketConnected ? 'WebSocket Connected' : 'WebSocket Disconnected';
  };

  return (
    <div 
      style={dotStyle}
      title={getTooltipText()}
    />
  );
};

export default ConnectionStatus;
