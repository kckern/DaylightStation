import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActionIcon } from '@mantine/core';
import { localDateISO } from "../portable/contracts/health/isoDate.mjs";
import { useApiResource } from "../../../../frontend/src/lib/hooks/useApiResource.js";
import { AgentConversationProvider, useAgentConversation } from "../../../../__capabilities/agent-runtime/browser/chat.mjs";
import { refreshHealthResourcesWithDashboard } from "./healthResources.js";
import { claimHealthCacheOwner, healthCacheHeldByOther, HEALTH_CONTEXT_PATH, hydrateHealthCache, useHealthCacheHydrated } from "./healthCache.js";
import '@mantine/core/styles.css';
import {
  AppThemeProvider, AppChrome, AppView, DismissStackProvider, LoadingState, ErrorState, useRetryRegion,
  UiIcon,
} from '@/lib/ui';
import { useViewScroll } from '@/lib/ui/useViewScroll.js';
import { useHotkey } from '@/lib/hooks/useHotkey.js';
import useDocumentTitle from "../../../../frontend/src/hooks/useDocumentTitle.js";
import CoachChat from "./CoachChat/index.jsx";
import { ChatOverlay } from "./ChatOverlay/index.jsx";
import { TodayView } from "./today/TodayView.jsx";
import { useLayoutShiftLog } from "./useLayoutShiftLog.js";
import { HealthDisplayPreferencesProvider } from "./display/HealthDisplayPreferences.jsx";
import "./health.scss";
import { HealthOperationsProvider } from "./operations/HealthOperationsProvider.jsx";
const ProgressView = lazy(() => import("./progress/ProgressView.jsx").then(module => ({ default: module.ProgressView })));
const MedicalView = lazy(() => import("./medical/MedicalView.jsx").then(module => ({ default: module.MedicalView })));
const HealthSettings = lazy(() => import("./cleanup/HealthSettings.jsx").then(module => ({ default: module.HealthSettings })));
const AuditorPage = lazy(() => import("./auditor/AuditorPage.jsx").then(module => ({ default: module.AuditorPage })));

const TABS = [
  { id: 'today', href: '/health', label: 'Today', icon: <UiIcon name="plus" size={20} /> },
  { id: 'progress', href: '/health/progress', label: 'Progress', icon: <UiIcon name="chart" size={20} /> },
  { id: 'health', href: '/health/medical', label: 'Medical', icon: <UiIcon name="heart" size={20} /> },
  { id: 'coach', href: '/health/coach', label: 'Coach', icon: <UiIcon name="coach" size={20} /> },
];

function tabForPath(pathname) {
  // The auditor opens from Settings, outside primary navigation.
  if (pathname.startsWith('/health/settings') || pathname.startsWith('/health/auditor')) return 'settings';
  return TABS.find(tab => pathname === tab.href || (tab.id !== 'today' && pathname.startsWith(tab.href + '/')))?.id || 'today';
}

// Start reading the disk cache while the bundle is still evaluating.
hydrateHealthCache();

// Restore the disk cache before the first read, so a reopened page paints its
// last-seen data on the first frame (healthCache.js).
const HealthApp = () => (useHealthCacheHydrated() ? <HealthGate />
  : <AppThemeProvider pack="health"><LoadingState label="Health" /></AppThemeProvider>);

const HealthGate = () => {
  const context = useApiResource(HEALTH_CONTEXT_PATH, { swr: true });
  const confirmedContext = !context.revalidating && !context.loading && !context.error ? context.data : null;
  const [, setClaimedUserId] = useState(null);
  useEffect(() => {
    if (!confirmedContext?.userId) return;
    claimHealthCacheOwner(confirmedContext);
    setClaimedUserId(confirmedContext.userId); // re-render once the cache is theirs
  }, [confirmedContext]);
  // The server named someone other than whose snapshots the cache holds: do
  // not mount their shell on the other person's data; the claim above clears it.
  const heldByOther = healthCacheHeldByOther(context.data?.userId);
  const canShowShell = Boolean(context.data?.userId) && !heldByOther;
  const { regionProps, retry } = useRetryRegion(context.reload, !canShowShell && (context.loading || context.revalidating));
  return (
    <section aria-label="Health" {...regionProps}>
      {canShowShell ? (
        <HealthDisplayPreferencesProvider key={context.data.userId} userId={context.data.userId}
          densityLevels={context.data.densityLevels} densityRevision={context.data.densityRevision}>
          <HealthOperationsProvider userId={context.data.userId}><HealthShell userId={context.data.userId} /></HealthOperationsProvider>
        </HealthDisplayPreferencesProvider>
      ) : (
        <AppThemeProvider pack="health">
          {context.error ? <ErrorState error={context.error} onRetry={retry} label="Health" /> : <LoadingState label="Health" />}
        </AppThemeProvider>
      )}
    </section>
  );
};

function RouteReady({ route, onReady }) {
  useLayoutEffect(() => { onReady(route); }, [route, onReady]);
  return null;
}

const HealthShell = ({ userId }) => {
  useDocumentTitle('Health');
  const navigate = useNavigate();
  const location = useLocation();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [coachEntry, setCoachEntry] = useState(null);
  const [sidebarTarget, setSidebarTarget] = useState(null);
  // The follow-ups bell's slot in the header (FollowUpTray portals into it).
  const [followUpTarget, setFollowUpTarget] = useState(null);
  const openCoach = entry => { setCoachEntry(entry || null); setOverlayOpen(true); };
  const conversation = useAgentConversation({ agentId: 'health-coach', userId,
    context: { selectedDate: new URLSearchParams(location.search).get('date') || localDateISO(new Date()),
      ...(coachEntry ? { selectedEntry: { id: coachEntry.uuid || coachEntry.id, date: coachEntry.date, name: coachEntry.name || coachEntry.item } } : {}) },
    persistSession: true, onComplete: refreshHealthResourcesWithDashboard });
  useHotkey('mod+k', () => openCoach(null));

  const activeTab = tabForPath(location.pathname);
  const todayActive = activeTab === 'today';
  // Unexpected page movement, per 1 s burst (ui.layout-shift).
  useLayoutShiftLog({ route: location.pathname, tab: activeTab });
  const mainRef = useRef(null);
  const [readyPath, setReadyPath] = useState(null);
  // Settings and Auditor share a navigation area but scroll independently.
  const viewPath = location.pathname.replace(/\/+$/, '');
  const routeReady = readyPath === viewPath;
  useViewScroll({ mainRef, viewKey: viewPath, owner: userId, ready: routeReady });
  const visitedToday = useRef(false);
  if (todayActive) visitedToday.current = true;
  return (
    <AppThemeProvider pack="health">
      <AgentConversationProvider conversation={conversation}>
        <DismissStackProvider>
          <AppChrome title="Health" mainRef={mainRef} tabs={TABS.map(tab => ({ ...tab, href: tab.href + location.search }))} activeTab={activeTab}
            sidebarRef={setSidebarTarget} sidebarActive={todayActive}
            headerActions={[
              <span key="follow-ups" ref={setFollowUpTarget} className="health-followups-slot" />,
              <ActionIcon key="settings" className="ds-touch-target" aria-label="Health settings"
                variant="subtle" onClick={() => navigate('/health/settings')}>
                <UiIcon name="settings" size={20} />
              </ActionIcon>,
             ]}>
            {/* Keep the logging session (drafts, pending requests, retry bytes)
                alive between tabs; hidden views do not poll or acquire media. */}
            {visitedToday.current ? <AppView active={todayActive} suspendOverlays={overlayOpen}>
              <TodayView active={todayActive} sidebarTarget={sidebarTarget} followUpTarget={followUpTarget} onSetupGoals={() => navigate(`/health/progress${location.search}`)} onCoachTap={openCoach} />
            </AppView> : null}
            <Suspense fallback={<LoadingState label="Health" />}><Routes>
              <Route index element={null} />
              <Route path="progress" element={<ProgressView />} />
              <Route path="medical" element={<MedicalView />} />
              <Route path="settings" element={<HealthSettings />} />
              <Route path="auditor" element={<AuditorPage routeReady={routeReady} />} />
              {/* CoachChat only supports variant 'light'|'overlay' (see AgentChatSurface) —
                  'full' isn't a real variant. The default 'light' variant is already the
                  full-height flex-column layout (`.coach-chat { height: 100% }`), which is
                  exactly what a tab-body mount needs, so we use it here unchanged. */}
              <Route path="coach" element={<CoachChat userId={userId} conversation={conversation} style={{ height: '100%' }} />} />
              {/* Unknown subpath — render Today rather than 404ing the tab shell. */}
              <Route path="*" element={<Navigate to="/health" replace />} />
            </Routes><RouteReady route={viewPath} onReady={setReadyPath} /></Suspense>
            <ChatOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} userId={userId}>
              <CoachChat userId={userId} conversation={conversation} variant="overlay" />
            </ChatOverlay>
          </AppChrome>
        </DismissStackProvider>
      </AgentConversationProvider>
    </AppThemeProvider>
  );
};

export default HealthApp;
