import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import { WebSocketProvider } from './contexts/WebSocketContext.jsx';
import HomeApp from './Apps/HomeApp.jsx';
import TVApp from './Apps/TVApp.jsx';
import FinanceApp from './Apps/FinanceApp.jsx';
import HealthApp from './Apps/HealthApp.jsx';
import LifelogApp from './Apps/LifelogApp.jsx';
import FitnessApp from './Apps/FitnessApp.jsx';
import Blank from './modules/Blank/Blank.jsx';
import { configurePlaybackLogger } from './modules/Player/lib/playbackLogger.js';

const getWebSocketUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  const port = window.location.port;
  
  // If running on dev port 3111, connect to backend on 3112
  if (port === '3111') {
    return `${protocol}//${host}:3112/ws`;
  }
  
  // Otherwise use relative path (production/same-origin)
  return `${protocol}//${window.location.host}/ws`;
};

// Enable playback logging via WebSocket
configurePlaybackLogger({
  websocket: {
    enabled: true,
    url: getWebSocketUrl()
  }
});

// Wrapper component for HomeApp with WebSocket
const HomeAppWithWebSocket = () => (
  <WebSocketProvider>
    <HomeApp />
  </WebSocketProvider>
); 

// Wrapper component for TVApp with app parameter
const TVAppWithParams = () => {
  const { app } = useParams();
  return <TVApp appParam={app} />;
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<HomeAppWithWebSocket />} />
      <Route path="/budget" element={<FinanceApp />} />
      <Route path="/finances" element={<FinanceApp />} />
      <Route path="/tv/app/:app" element={<TVAppWithParams />} />
      <Route path="/tv" element={<TVApp />} />
      <Route path="/health" element={<HealthApp />} />
      <Route path="/fitness" element={<FitnessApp />} />
      <Route path="/lifelog" element={<LifelogApp />} />
      <Route path="*" element={<Blank />} />
    </Routes>
  </BrowserRouter>,
);