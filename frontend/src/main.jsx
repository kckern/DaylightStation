import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, useParams, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { WebSocketProvider } from './contexts/WebSocketContext.jsx';
import RootApp from './Apps/RootApp.jsx';
import HomeApp from './Apps/HomeApp.jsx';
import FinanceApp from './Apps/FinanceApp.jsx';
import HealthApp from './Apps/HealthApp.jsx';
import LifeApp from './Apps/LifeApp.jsx';
import FitnessApp from './Apps/FitnessApp.jsx';
import FeedApp from './Apps/FeedApp.jsx';
import AdminApp from './Apps/AdminApp.jsx';
import CallApp from './Apps/CallApp.jsx';
import MediaApp from './Apps/MediaApp.jsx';
import LiveStreamApp from './Apps/LiveStreamApp.jsx';
import PianoApp from './Apps/PianoApp.jsx';
import AppContainer from './modules/AppContainer/AppContainer.jsx';
import Blank from './modules/Blank/Blank.jsx';
import FilterPoc from './modules/Player/poc/FilterPoc.jsx';
import SetupWizard from './modules/Auth/SetupWizard.jsx';
import InviteAccept from './modules/Auth/InviteAccept.jsx';
import { ScreenRenderer } from './screen-framework/index.js';
import { configurePlaybackLogger } from './modules/Player/lib/playbackLogger.js';
import { configureDaylightLogger, getDaylightLogger } from './lib/logging/singleton.js';
import { setupGlobalErrorHandlers } from './lib/logging/errorHandlers.js';
import { interceptConsole } from './lib/logging/consoleInterceptor.js';
import { installChunkReloadHandler } from './lib/chunkReload.js';

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

// Auto-recover from stale lazy chunks after a deploy (registered before the
// logging error handlers so the reload wins the unhandledrejection race).
// Without this, a deploy that rotates asset hashes leaves any lazy import on a
// long-lived tab DOA in a blank Suspense. See lib/chunkReload.js.
installChunkReloadHandler();

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

// Legacy /office routes redirect to screen-framework
const OfficeRedirect = () => <Navigate to="/screen/office" replace />;

// Legacy /tv (TVApp) retired in favor of the screen-framework living-room screen.
// Redirect so stale bookmarks / device configs still land somewhere valid — and
// PRESERVE the query string (?queue=/?play=/?shader= autoplay params the screen honors).
const TVRedirect = () => {
  const { search } = useLocation();
  return <Navigate to={`/screen/living-room${search}`} replace />;
};

// Standalone /app/:appId route — renders a registered app directly without the TV shell.
// Used for testing and direct linking to specific apps (e.g. /app/weekly-review).
const AppDirectRoute = () => {
  const { appId } = useParams();
  const navigate = useNavigate();
  return (
    <AppContainer
      open={{ app: appId }}
      clear={() => {
        if (window.history.length > 1) navigate(-1);
        else navigate('/');
      }}
    />
  );
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
    // Bounded: this fetch gates the ENTIRE app boot (render is null until it
    // settles). A congested backend that never answers must not blank every
    // page — after 5s, proceed without the setup redirect (login/claim flows
    // still enforce auth; this check is a fresh-install convenience).
    fetch('/api/v1/auth/context', { signal: AbortSignal.timeout(5000) })
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
        <Route path="/office" element={<OfficeRedirect />} />
        <Route path="/office/*" element={<OfficeRedirect />} />
        <Route path="/budget" element={<FinanceApp />} />
        <Route path="/finances" element={<FinanceApp />} />
        <Route path="/app/:appId" element={<AppDirectRoute />} />
        <Route path="/tv/*" element={<TVRedirect />} />
        <Route path="/tv" element={<TVRedirect />} />
        <Route path="/media" element={<MediaApp />} />
        <Route path="/media/channels/*" element={<LiveStreamApp />} />
        <Route path="/health" element={<HealthApp />} />
        <Route path="/fitness/*" element={<FitnessApp />} />
        <Route path="/piano/*" element={<PianoApp />} />
        <Route path="/life/*" element={<LifeApp />} />
        <Route path="/admin/*" element={<AdminApp />} />
        {["/screen/:screenId/*", "/screens/:screenId/*"].map(p => <Route key={p} path={p} element={<WebSocketProvider><ScreenRenderer /></WebSocketProvider>} />)}
        <Route path="/setup" element={<SetupWizard onComplete={() => window.location.href = '/'} />} />
        <Route path="/invite/:token" element={<InviteAccept />} />
        <Route path="/filter-poc" element={<FilterPoc />} />
        <Route path="/feed/*" element={<FeedApp />} />
        <Route path="/call" element={<CallApp />} />
        <Route path="*" element={<Blank />} />
      </Routes>
    </SetupCheck>
  </BrowserRouter>
  </MantineProvider>,
);