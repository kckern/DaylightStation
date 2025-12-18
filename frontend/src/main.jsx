import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import { WebSocketProvider } from './contexts/WebSocketContext.jsx';
import RootApp from './Apps/RootApp.jsx';
import HomeApp from './Apps/HomeApp.jsx';
import OfficeApp from './Apps/OfficeApp.jsx';
import ConfigApp from './Apps/ConfigApp.jsx';
import TVApp from './Apps/TVApp.jsx';
import FinanceApp from './Apps/FinanceApp.jsx';
import HealthApp from './Apps/HealthApp.jsx';
import LifelogApp from './Apps/LifelogApp.jsx';
import FitnessApp from './Apps/FitnessApp.jsx';
import Blank from './modules/Blank/Blank.jsx';
import { configurePlaybackLogger } from './modules/Player/lib/playbackLogger.js';
import { configureDaylightLogger, getDaylightLogger } from './lib/logging/singleton.js';

const getWebSocketUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // With Vite proxy, WebSocket connects to same origin (proxy forwards /ws to backend)
  return `${protocol}//${window.location.host}/ws`;
};

// Bootstrap DaylightLogger and expose a shared frontend logger
configureDaylightLogger({
  websocket: true,
  wsUrl: getWebSocketUrl(),
  context: {
    app: 'frontend'
  }
});
const frontendLogger = getDaylightLogger();
if (typeof window !== 'undefined') {
  window.DaylightLogger = frontendLogger;
}
frontendLogger.info('frontend-start', { path: window.location?.pathname });

// Enable playback logging via WebSocket
configurePlaybackLogger({
  websocket: {
    enabled: true,
    // Force playback logger to the same backend websocket endpoint used by the Daylight logger
    url: getWebSocketUrl()
  },
  forwardToDaylight: true,
  level: 'debug'
});

// Wrapper component for OfficeApp with WebSocket
const OfficeAppWithWebSocket = () => (
  <WebSocketProvider>
    <OfficeApp />
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
      <Route path="/" element={<RootApp />} />
      <Route path="/home" element={<HomeApp />} />
      <Route path="/office" element={<OfficeAppWithWebSocket />} />
      <Route path="/config" element={<ConfigApp />} />
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