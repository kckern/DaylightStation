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
import AutoApp from './Apps/AutoApp.jsx';
import LifeApp from './Apps/LifeApp.jsx';
import FitnessApp from './Apps/FitnessApp.jsx';
import FeedApp from './Apps/FeedApp.jsx';
import AdminApp from './Apps/AdminApp.jsx';
import CallApp from './Apps/CallApp.jsx';
import MediaApp from './Apps/MediaApp.jsx';
import LiveStreamApp from './Apps/LiveStreamApp.jsx';
import PianoApp from './Apps/PianoApp.jsx';
import AppContainer from './modules/AppContainer/AppContainer.jsx';
// Lazy: the teacher console is a parent's phone surface — its module and
// styles must not ride in the bundle every kiosk loads.
const TeacherConsole = React.lazy(() => import('./modules/School/teacher/TeacherConsole.jsx'));
const GamingApp = React.lazy(() => import('./Apps/GamingApp.jsx'));
const GameDemoApp = React.lazy(() => import('./Apps/GameDemoApp.jsx'));
const TeacherConsoleRoute = () => (
  <React.Suspense fallback={<div />}> <TeacherConsole /> </React.Suspense>
);
import Blank from './modules/Blank/Blank.jsx';
import FilterPoc from './modules/Player/poc/FilterPoc.jsx';
import SetupWizard from './modules/Auth/SetupWizard.jsx';
import InviteAccept from './modules/Auth/InviteAccept.jsx';
import { ScreenRenderer } from './screen-framework/index.js';
import GroupPlayHost from './modules/Gaming/environments/group-play/surfaces/GroupPlayHost.jsx';
import GroupPlayVerifier from './modules/Gaming/environments/group-play/surfaces/GroupPlayVerifier.jsx';
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

// /school/<deep-path> → /app/school/<deep-path>, keeping School's own
// segments (subject/…, library/…, material/…) intact through the redirect.
const SchoolDeepLinkRedirect = () => {
  const { pathname, search } = useLocation();
  return <Navigate to={`/app${pathname}${search}`} replace />;
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
        {/* /school — first-class URL for the School app; AppDirectRoute serves it.
            The splat carries School's own deep-link segments (subject/…,
            library, material/…), which SchoolApp parses itself. */}
        <Route path="/school" element={<Navigate to="/app/school" replace />} />
        {/* The teacher console is its OWN surface, not the school app — these
            static routes outrank the /school/* splat (v6 ranking), so the
            kids' shell never parses a /school/teacher URL. */}
        <Route path="/school/teacher" element={<TeacherConsoleRoute />} />
        <Route path="/school/teacher/*" element={<TeacherConsoleRoute />} />
        <Route path="/school/*" element={<SchoolDeepLinkRedirect />} />
        <Route path="/app/:appId/*" element={<AppDirectRoute />} />
        <Route path="/app/:appId" element={<AppDirectRoute />} />
        <Route path="/tv/*" element={<TVRedirect />} />
        <Route path="/tv" element={<TVRedirect />} />
        <Route path="/media" element={<MediaApp />} />
        <Route path="/media/channels/*" element={<LiveStreamApp />} />
        <Route path="/health" element={<HealthApp />} />
        {/* Vehicle record system — mobile-first; see docs/_wip/plans/2026-08-12-auto-app-design.md */}
        <Route path="/auto" element={<AutoApp />} />
        <Route path="/auto/*" element={<AutoApp />} />
        <Route path="/fitness/*" element={<FitnessApp />} />
        <Route path="/piano/*" element={<PianoApp />} />
        <Route path="/gaming/*" element={<React.Suspense fallback={null}><GamingApp /></React.Suspense>} />
        <Route path="/game/demo" element={<React.Suspense fallback={null}><GameDemoApp /></React.Suspense>} />
        <Route path="/life/*" element={<LifeApp />} />
        <Route path="/admin/*" element={<AdminApp />} />
        {["/screen/:screenId/*", "/screens/:screenId/*"].map(p => <Route key={p} path={p} element={<WebSocketProvider><ScreenRenderer /></WebSocketProvider>} />)}
        {/* Host companion talks to the singleton wsService directly (auto-connects on
            first subscription) — no WebSocketProvider needed. Commands go out via HTTP. */}
        <Route path="/group-play/host/:sessionId" element={<GroupPlayHost />} />
        <Route path="/group-play/verify/:sessionId" element={<GroupPlayVerifier />} />
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
