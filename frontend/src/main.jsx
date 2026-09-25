import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, useParams, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { installRootTokens } from './lib/theme/installRootTokens.js';
import { createAppTheme } from './lib/theme/createAppTheme.js';
import { OfficeRedirect, TVRedirect, SchoolDeepLinkRedirect, TeacherNextRedirect } from './routeRedirects.jsx';
import { WebSocketProvider } from './contexts/WebSocketContext.jsx';
// Every route is its own chunk: a page downloads the app it shows, not all
// of them (the single bundle had grown past 11 MB). A long-lived tab whose
// chunk hashes rotate under it on a deploy is recovered by chunkReload.js.
const loadHomeApp = () => import('./Apps/HomeApp.jsx');
const HomeApp = React.lazy(loadHomeApp);
const loadFinanceApp = () => import('./Apps/FinanceApp.jsx');
const FinanceApp = React.lazy(loadFinanceApp);
const loadHealthApp = () => import('./Apps/HealthApp.jsx');
const HealthApp = React.lazy(loadHealthApp);
const loadAutoApp = () => import('./Apps/AutoApp.jsx');
const AutoApp = React.lazy(loadAutoApp);
const loadLifeApp = () => import('./Apps/LifeApp.jsx');
const LifeApp = React.lazy(loadLifeApp);
const loadFitnessApp = () => import('./Apps/FitnessApp.jsx');
const FitnessApp = React.lazy(loadFitnessApp);
const loadFeedApp = () => import('./Apps/FeedApp.jsx');
const FeedApp = React.lazy(loadFeedApp);
const loadAdminApp = () => import('./Apps/AdminApp.jsx');
const AdminApp = React.lazy(loadAdminApp);
const loadCallApp = () => import('./Apps/CallApp.jsx');
const CallApp = React.lazy(loadCallApp);
const loadMediaApp = () => import('./Apps/MediaApp.jsx');
const MediaApp = React.lazy(loadMediaApp);
const loadLiveStreamApp = () => import('./Apps/LiveStreamApp.jsx');
const LiveStreamApp = React.lazy(loadLiveStreamApp);
const loadPianoApp = () => import('./Apps/PianoApp.jsx');
const PianoApp = React.lazy(loadPianoApp);
const loadAppContainer = () => import('./modules/AppContainer/AppContainer.jsx');
const AppContainer = React.lazy(loadAppContainer);
const Blank = React.lazy(() => import('./modules/Blank/Blank.jsx'));
const FilterPoc = React.lazy(() => import('./modules/Player/poc/FilterPoc.jsx'));
const SetupWizard = React.lazy(() => import('./modules/Auth/SetupWizard.jsx'));
const InviteAccept = React.lazy(() => import('./modules/Auth/InviteAccept.jsx'));
const PartyGamesHost = React.lazy(() => import('./modules/Gaming/environments/party-games/surfaces/PartyGamesHost.jsx'));
const PartyGamesVerifier = React.lazy(() => import('./modules/Gaming/environments/party-games/surfaces/PartyGamesVerifier.jsx'));
const loadScreenRenderer = () => import('./screen-framework/index.js');
const ScreenRenderer = React.lazy(() => loadScreenRenderer().then(module => ({ default: module.ScreenRenderer })));
// Start this page's chunk NOW, not once SetupCheck's auth request has
// answered and <Routes> first renders: the two then load side by side.
// React.lazy's later import() of the same module reuses this download.
const ROUTE_CHUNKS = [
  [/^\/health(\/|$)/, loadHealthApp], [/^\/fitness(\/|$)/, loadFitnessApp], [/^\/piano(\/|$)/, loadPianoApp],
  [/^\/screens?\//, loadScreenRenderer], [/^\/(budget|finances)$/, loadFinanceApp], [/^\/life(\/|$)/, loadLifeApp],
  [/^\/auto(\/|$)/, loadAutoApp], [/^\/home$/, loadHomeApp], [/^\/media$/, loadMediaApp],
  [/^\/media\/channels\//, loadLiveStreamApp], [/^\/feed(\/|$)/, loadFeedApp], [/^\/call$/, loadCallApp],
  [/^\/(admin(\/|$)|$)/, loadAdminApp], [/^\/app\//, loadAppContainer],
];
ROUTE_CHUNKS.find(([pattern]) => pattern.test(window.location.pathname))?.[1]().catch(() => { /* the route's own lazy import surfaces the failure (chunkReload.js) */ });
// Lazy: the teacher console is a parent's phone surface — its module and
// styles must not ride in the bundle every kiosk loads.
const TeacherConsole = React.lazy(() => import('./modules/School/teacher/TeacherConsole.jsx'));
const GamingApp = React.lazy(() => import('./Apps/GamingApp.jsx'));
const GamePresentationHarness = React.lazy(() => import('./dev/GamePresentationHarness/GamePresentationHarness.jsx'));
const DsGallery = React.lazy(() => import('./dev/DsGallery/DsGallery.jsx'));
const DecoderSwatches = React.lazy(() => import('./dev/DecoderSwatches/DecoderSwatches.jsx'));
const TeacherConsoleRoute = () => (
  <React.Suspense fallback={<div />}> <TeacherConsole /> </React.Suspense>
);
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

// The design-system tokens on :root, before anything renders (see
// lib/theme/installRootTokens.js).
installRootTokens();

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

// Standalone /app/:appId route — renders a registered app directly without the TV shell.
// Used for testing and direct linking to specific apps (e.g. /app/weekly-review).
const AppDirectRoute = () => {
  const { appId, '*': appPath } = useParams();
  const navigate = useNavigate();
  return (
    <AppContainer
      open={{ app: appPath ? `${appId}/${appPath}` : appId }}
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
  <MantineProvider theme={createAppTheme(null)} defaultColorScheme="dark">
  <BrowserRouter>
    <SetupCheck>
      <React.Suspense fallback={null}>
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
        <Route path="/school" element={<SchoolDeepLinkRedirect />} />
        {/* The teacher console is its OWN surface, not the school app — these
            static routes outrank the /school/* splat (v6 ranking), so the
            kids' shell never parses a /school/teacher URL. */}
        <Route path="/school/teacher" element={<TeacherConsoleRoute />} />
        <Route path="/school/teacher/*" element={<TeacherConsoleRoute />} />
        {/* Retired rollout alias — redirect, don't 404 (see routeRedirects.jsx). */}
        <Route path="/school/teacher-next" element={<TeacherNextRedirect />} />
        <Route path="/school/teacher-next/*" element={<TeacherNextRedirect />} />
        <Route path="/school/*" element={<SchoolDeepLinkRedirect />} />
        <Route path="/app/:appId/*" element={<AppDirectRoute />} />
        <Route path="/app/:appId" element={<AppDirectRoute />} />
        <Route path="/tv/*" element={<TVRedirect />} />
        <Route path="/tv" element={<TVRedirect />} />
        <Route path="/media" element={<MediaApp />} />
        <Route path="/media/channels/*" element={<LiveStreamApp />} />
        <Route path="/health" element={<HealthApp />} />
        <Route path="/health/*" element={<HealthApp />} />
        {/* Vehicle record system — mobile-first; see docs/_wip/plans/2026-08-12-auto-app-design.md */}
        <Route path="/auto" element={<AutoApp />} />
        <Route path="/auto/*" element={<AutoApp />} />
        <Route path="/fitness/*" element={<FitnessApp />} />
        <Route path="/piano/*" element={<PianoApp />} />
        <Route path="/dev/gaming/*" element={<React.Suspense fallback={null}><GamingApp /></React.Suspense>} />
        <Route path="/dev/game-presentation-harness" element={<React.Suspense fallback={null}><GamePresentationHarness /></React.Suspense>} />
        <Route path="/dev/ds-gallery" element={<React.Suspense fallback={null}><DsGallery /></React.Suspense>} />
        <Route path="/dev/decoder-swatches" element={<React.Suspense fallback={null}><DecoderSwatches /></React.Suspense>} />
        <Route path="/life/*" element={<LifeApp />} />
        <Route path="/admin/*" element={<AdminApp />} />
        {["/screen/:screenId/*", "/screens/:screenId/*"].map(p => <Route key={p} path={p} element={<WebSocketProvider><ScreenRenderer /></WebSocketProvider>} />)}
        {/* Host companion talks to the singleton wsService directly (auto-connects on
            first subscription) — no WebSocketProvider needed. Commands go out via HTTP. */}
        <Route path="/party-games/host/:sessionId" element={<PartyGamesHost />} />
        <Route path="/party-games/verify/:sessionId" element={<PartyGamesVerifier />} />
        <Route path="/setup" element={<SetupWizard onComplete={() => window.location.href = '/'} />} />
        <Route path="/invite/:token" element={<InviteAccept />} />
        <Route path="/filter-poc" element={<FilterPoc />} />
        <Route path="/feed/*" element={<FeedApp />} />
        {/* Deliberately ungated. Home Line is a tin can: no user provisioning,
            no sign-in, no identification. It is reachable only from the house
            network or over the VPN, and that is the access boundary. Whoever
            picks it up can talk into it. */}
        <Route path="/call" element={<CallApp />} />
        <Route path="*" element={<Blank />} />
      </Routes>
      </React.Suspense>
    </SetupCheck>
  </BrowserRouter>
  </MantineProvider>,
);
