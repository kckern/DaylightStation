import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import { localDateISO } from '@shared-contracts/health/isoDate.mjs';
import { useApiResource } from '../lib/hooks/useApiResource.js';
import { AgentConversationProvider, useAgentConversation } from '../modules/Agent/AgentChatSurface.jsx';
import { refreshHealthResources } from '../modules/Health/healthResources.js';
import '@mantine/core/styles.css';
import {
  AppThemeProvider, AppChrome, DismissStackProvider, LoadingState, ErrorState,
} from '@/lib/ui';
import { useHotkey } from '@/lib/hooks/useHotkey.js';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import CoachChat from '../modules/Health/CoachChat';
import { ChatOverlay } from '../modules/Health/ChatOverlay/index.jsx';
import { TodayView } from '../modules/Health/today/TodayView.jsx';
import '../modules/Health/health.scss';
const ProgressView = lazy(() => import('../modules/Health/progress/ProgressView.jsx').then(module => ({ default: module.ProgressView })));
const MedicalView = lazy(() => import('../modules/Health/medical/MedicalView.jsx').then(module => ({ default: module.MedicalView })));

const Icon = ({ d }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const TABS = [
  { id: 'today', label: 'Today', icon: <Icon d="M4 10h12M10 4v12" /> },
  { id: 'progress', label: 'Progress', icon: <Icon d="M3 15l4-6 4 3 6-8" /> },
  { id: 'health', label: 'Medical', icon: <Icon d="M10 17s-6-3.5-6-8a3.5 3.5 0 016-2.4A3.5 3.5 0 0116 9c0 4.5-6 8-6 8z" /> },
  { id: 'coach', label: 'Coach', icon: <Icon d="M3 5h14v9H8l-4 3v-3H3z" /> },
];

// A top-level tab's route, keyed by AppChrome's tab id. "today" is the bare
// /health path (no trailing segment) — matches the index route below.
const TAB_PATH = { today: '/health', progress: '/health/progress', health: '/health/medical', coach: '/health/coach' };

// Which tab a pathname belongs to — the inverse of TAB_PATH. Any unrecognized
// /health/* subpath (including the bare /health itself) falls through to
// "today", matching the index route's <Navigate>-free default render.
function tabForPath(pathname) {
  if (pathname.startsWith('/health/progress')) return 'progress';
  if (pathname.startsWith('/health/medical')) return 'health';
  if (pathname.startsWith('/health/coach')) return 'coach';
  return 'today';
}

const HealthApp = () => {
  const context = useApiResource('api/v1/health/context', { swr: true });
  return context.data?.userId ? <HealthShell key={context.data.userId} userId={context.data.userId} />
    : <AppThemeProvider pack="health">{context.error ? <ErrorState error={context.error} onRetry={context.reload} label="Health" /> : <LoadingState label="Health" />}</AppThemeProvider>;
};

const HealthShell = ({ userId }) => {
  useDocumentTitle('Health');
  const navigate = useNavigate();
  const location = useLocation();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [coachEntry, setCoachEntry] = useState(null);
  const openCoach = entry => { setCoachEntry(entry || null); setOverlayOpen(true); };
  const conversation = useAgentConversation({ agentId: 'health-coach', userId,
    context: { selectedDate: new URLSearchParams(location.search).get('date') || localDateISO(new Date()),
      ...(coachEntry ? { selectedEntry: { id: coachEntry.uuid || coachEntry.id, date: coachEntry.date, name: coachEntry.name || coachEntry.item } } : {}) },
    persistSession: true, onComplete: refreshHealthResources });
  useHotkey('mod+k', () => openCoach(null));

  const activeTab = tabForPath(location.pathname);
  const shellRef = useRef(null);
  const scrollPositions = useRef(new Map());
  const visitedToday = useRef(false);
  if (activeTab === 'today') visitedToday.current = true;
  useLayoutEffect(() => {
    const main = shellRef.current?.querySelector('.ds-chrome__main');
    if (main) main.scrollTop = scrollPositions.current.get(activeTab) || 0;
  }, [activeTab]);

  return (
    <AppThemeProvider pack="health">
      <AgentConversationProvider conversation={conversation}>
        <DismissStackProvider>
          <div ref={shellRef} style={{ height: '100%' }} onScrollCapture={event => {
            if (event.target.matches('.ds-chrome__main')) scrollPositions.current.set(activeTab, event.target.scrollTop);
          }}>
          <AppChrome title="Health" tabs={TABS} activeTab={activeTab}
            onTabChange={(id) => navigate(`${TAB_PATH[id] || '/health'}${location.search}`)}>
            {/* Keep the logging session (drafts, pending requests, retry bytes)
                alive between tabs; hidden views do not poll or acquire media. */}
            {visitedToday.current ? <div hidden={activeTab !== 'today'}>
              <TodayView active={activeTab === 'today'} onSetupGoals={() => navigate(`/health/progress${location.search}`)} onCoachTap={openCoach} />
            </div> : null}
            <Suspense fallback={<LoadingState label="Health" />}><Routes>
              <Route index element={null} />
              <Route path="progress" element={<ProgressView />} />
              <Route path="medical" element={<MedicalView />} />
              {/* CoachChat only supports variant 'light'|'overlay' (see AgentChatSurface) —
                  'full' isn't a real variant. The default 'light' variant is already the
                  full-height flex-column layout (`.coach-chat { height: 100% }`), which is
                  exactly what a tab-body mount needs, so we use it here unchanged. */}
              <Route path="coach" element={<CoachChat userId={userId} conversation={conversation} style={{ height: '100%' }} />} />
              {/* Unknown subpath — render Today rather than 404ing the tab shell. */}
              <Route path="*" element={<Navigate to="/health" replace />} />
            </Routes></Suspense>
          </AppChrome>
          </div>
          <ChatOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} userId={userId}>
            <CoachChat userId={userId} conversation={conversation} variant="overlay" />
          </ChatOverlay>
        </DismissStackProvider>
      </AgentConversationProvider>
    </AppThemeProvider>
  );
};

export default HealthApp;
