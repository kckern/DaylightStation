import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, useParams, Navigate, useLocation } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { WebSocketProvider } from './contexts/WebSocketContext.jsx';
import RootApp from './Apps/RootApp.jsx';
import HomeApp from './Apps/HomeApp.jsx';
import OfficeApp from './Apps/OfficeApp.jsx';
import TVApp from './Apps/TVApp.jsx';
import FinanceApp from './Apps/FinanceApp.jsx';
import HealthApp from './Apps/HealthApp.jsx';
import LifelogApp from './Apps/LifelogApp.jsx';
import FitnessApp from './Apps/FitnessApp.jsx';
import AdminApp from './Apps/AdminApp.jsx';
import Blank from './modules/Blank/Blank.jsx';
import SetupWizard from './modules/Auth/SetupWizard.jsx';
import InviteAccept from './modules/Auth/InviteAccept.jsx';
import { ScreenRenderer } from './screen-framework/index.js';
import { configurePlaybackLogger } from './modules/Player/lib/playbackLogger.js';
import { configureDaylightLogger, getDaylightLogger } from './lib/logging/singleton.js';
import { setupGlobalErrorHandlers } from './lib/logging/errorHandlers.js';
import { interceptConsole } from './lib/logging/consoleInterceptor.js';

const getWebSocketUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // With Vite proxy, WebSocket connects to same origin (proxy forwards /ws to backend)
  return `${protocol}//${window.location.host}/ws`;
};

// ========== PHASE 4 DEBUG: Check if code reloads ==========
console.error('🔥 PHASE 4 CODE LOADED - main.jsx timestamp:', new Date().toISOString());
console.error('🔥 VERSION: Added EFFECTIVE_ROSTER and ACTIVE_PARTICIPANTS logging');
// ===========================================================

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

// Set up global error handlers to capture uncaught errors and promise rejections
setupGlobalErrorHandlers();

// Intercept console methods to forward all console.log/warn/error calls to backend
interceptConsole({
  interceptLog: true,
  interceptInfo: true,
  interceptWarn: true,
  interceptError: true,
  interceptDebug: false // Off by default (too noisy)
});

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

// Wrapper that redirects to /setup when no users have been created yet
function SetupCheck({ children }) {
  const [checked, setChecked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const location = useLocation();

  useEffect(() => {
    // Skip check on setup and invite pages
    if (location.pathname === '/setup' || location.pathname.startsWith('/invite/')) {
      setChecked(true);
      return;
    }
    fetch('/api/v1/auth/context')
      .then(r => r.json())
      .then(data => {
        // Only redirect to setup wizard for fresh installs (no profiles at all).
        // When profiles exist but no passwords (setupAdmin present), the
        // LoginScreen claim flow handles it instead.
        setNeedsSetup(data.needsSetup && !data.setupAdmin);
        setChecked(true);
      })
      .catch(() => setChecked(true));
  }, [location.pathname]);

  if (!checked) return null;
  if (needsSetup && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }
  return children;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <MantineProvider>
  <BrowserRouter>
    <SetupCheck>
      <Routes>
        <Route path="/" element={<AdminApp />} />
        <Route path="/home" element={<HomeApp />} />
        <Route path="/office" element={<OfficeAppWithWebSocket />} />
        <Route path="/budget" element={<FinanceApp />} />
        <Route path="/finances" element={<FinanceApp />} />
        <Route path="/tv/app/:app" element={<TVAppWithParams />} />
        <Route path="/tv" element={<TVApp />} />
        <Route path="/health" element={<HealthApp />} />
        <Route path="/fitness/*" element={<FitnessApp />} />
        <Route path="/lifelog" element={<LifelogApp />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="/screen/:screenId" element={<ScreenRenderer />} />
        <Route path="/setup" element={<SetupWizard onComplete={() => window.location.href = '/'} />} />
        <Route path="/invite/:token" element={<InviteAccept />} />
        <Route path="*" element={<Blank />} />
      </Routes>
    </SetupCheck>
  </BrowserRouter>
  </MantineProvider>,
);