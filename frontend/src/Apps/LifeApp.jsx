import { useEffect } from 'react';
import { Select } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import {
  IconDashboard, IconTimeline, IconTarget, IconHeart, IconBrain, IconDiamond, IconShield,
  IconCalendarEvent, IconMessageCircle,
} from '@tabler/icons-react';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './LifeApp.scss';
import { AppThemeProvider, AppChrome, createAppLogger } from '@/lib/ui';
import { configure } from '../lib/logging/Logger.js';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { Dashboard } from '../modules/Life/views/now/Dashboard.jsx';
import { LogBrowser } from '../modules/Life/views/log/LogBrowser.jsx';
import { LogDayDetail } from '../modules/Life/views/log/LogDayDetail.jsx';
import { LogCategoryView } from '../modules/Life/views/log/LogCategoryView.jsx';
import { PurposeView } from '../modules/Life/views/plan/PurposeView.jsx';
import { GoalsView } from '../modules/Life/views/plan/GoalsView.jsx';
import { GoalDetail } from '../modules/Life/views/plan/GoalDetail.jsx';
import { BeliefsView } from '../modules/Life/views/plan/BeliefsView.jsx';
import { ValuesView } from '../modules/Life/views/plan/ValuesView.jsx';
import { QualitiesView } from '../modules/Life/views/plan/QualitiesView.jsx';
import { CeremonyConfig } from '../modules/Life/views/plan/CeremonyConfig.jsx';
import { CeremonyFlow } from '../modules/Life/views/ceremony/CeremonyFlow.jsx';
import CoachChat from '../modules/Life/views/coach/CoachChat.jsx';
import { LifeUserContext, useLifeUser } from '../modules/Life/hooks/useLifeUser.js';
import { useAppNotifications } from '../modules/Life/hooks/useAppNotifications.js';

const logger = createAppLogger('life');

// Top-level tabs. Every child that used to live under the navbar's "Plan"
// disclosure group now lives one level down, inside the Plan tab's own body —
// see PLAN_LINKS below — so this list matches the four things that used to be
// directly clickable from the root of the old navbar (Now / Log / Plan / Coach).
const TABS = [
  { id: 'now', label: 'Now', icon: <IconDashboard size={20} /> },
  { id: 'log', label: 'Log', icon: <IconTimeline size={20} /> },
  { id: 'plan', label: 'Plan', icon: <IconTarget size={20} /> },
  { id: 'coach', label: 'Coach', icon: <IconMessageCircle size={20} /> },
];

// The old navbar's nested "Plan" NavLink group, ported to an in-view secondary
// nav rendered above the routed content whenever a /life/plan* route is active.
// `match` mirrors the old `isActive()`/exact-path checks so highlighting is
// identical: Purpose only lights up for the bare /life/plan path (every other
// child route also starts with /life/plan and would otherwise always match it).
const PLAN_LINKS = [
  { path: '/life/plan', label: 'Purpose', icon: <IconHeart size={14} />, match: (p) => p === '/life/plan' },
  { path: '/life/plan/goals', label: 'Goals', icon: <IconTarget size={14} />, match: (p) => p.startsWith('/life/plan/goals') },
  { path: '/life/plan/beliefs', label: 'Beliefs', icon: <IconBrain size={14} />, match: (p) => p.startsWith('/life/plan/beliefs') },
  { path: '/life/plan/values', label: 'Values', icon: <IconDiamond size={14} />, match: (p) => p.startsWith('/life/plan/values') },
  { path: '/life/plan/qualities', label: 'Qualities', icon: <IconShield size={14} />, match: (p) => p.startsWith('/life/plan/qualities') },
  { path: '/life/plan/ceremonies', label: 'Ceremonies', icon: <IconCalendarEvent size={14} />, match: (p) => p.startsWith('/life/plan/ceremonies') },
];

function PlanSecondaryNav({ pathname, navigate }) {
  return (
    <nav className="life-plan-subnav" aria-label="Plan sections">
      {PLAN_LINKS.map((link) => (
        <a
          key={link.path}
          role="link"
          tabIndex={0}
          className={`life-plan-subnav__link${link.match(pathname) ? ' life-plan-subnav__link--active' : ''}`}
          aria-current={link.match(pathname) ? 'page' : undefined}
          onClick={() => navigate(link.path)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(link.path); }}
        >
          {link.icon}
          <span>{link.label}</span>
        </a>
      ))}
    </nav>
  );
}

const LogDayRoute = () => {
  const { date } = useParams();
  return <LogDayDetail date={date} />;
};

const LogCategoryRoute = () => {
  const { category } = useParams();
  return <LogCategoryView category={category} />;
};

const GoalDetailRoute = () => {
  const { goalId } = useParams();
  return <GoalDetail goalId={goalId} />;
};

const CeremonyRoute = () => {
  const { type } = useParams();
  const navigate = useNavigate();
  return <CeremonyFlow type={type} onComplete={() => navigate('/life/now')} />;
};

// Which top-level tab a path belongs to. A /life/ceremony/* path (reached
// from a priority card, not from the navbar) matches none of these — same as
// the old navbar, where none of its NavLinks lit up during a ceremony either.
function tabForPath(pathname) {
  if (pathname.startsWith('/life/now')) return 'now';
  if (pathname.startsWith('/life/log')) return 'log';
  if (pathname.startsWith('/life/plan')) return 'plan';
  if (pathname.startsWith('/life/coach')) return 'coach';
  return null;
}

function LifeAppShell() {
  useDocumentTitle('Life');
  const navigate = useNavigate();
  const location = useLocation();
  const { user: lifeUser, users: lifeUsers, setUsername } = useLifeUser();

  // Render the in-app fallback channel for the notification service. Most
  // household members have no Telegram/HA push, so this WS toast is the only
  // channel they can receive; intents addressed to another member are dropped.
  useAppNotifications({ username: lifeUser?.username || null, navigate });

  // Enable session file logging — writes to media/logs/life/<timestamp>.jsonl
  useEffect(() => {
    configure({ context: { app: 'life', sessionLog: true } });
    logger.info('life.app.mounted');
    return () => {
      logger.info('life.app.unmounted');
      configure({ context: { sessionLog: false } });
    };
  }, []);

  // Log route changes
  useEffect(() => {
    logger.info('life.route.changed', { path: location.pathname });
  }, [location.pathname]);

  const activeTab = tabForPath(location.pathname);

  const headerActions = lifeUsers.length > 1 ? [(
    <Select
      key="user-switch"
      size="xs"
      w={150}
      aria-label="Switch household member"
      allowDeselect={false}
      data={lifeUsers.map((u) => ({ value: u.username, label: u.displayName }))}
      value={lifeUser?.username || null}
      onChange={(val) => { if (val) setUsername(val); }}
    />
  )] : undefined;

  return (
    <LifeUserContext.Provider value={lifeUser}>
      <Notifications position="top-right" autoClose={8000} />
      <AppChrome
        title="Life"
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(id) => navigate(`/life/${id}`)}
        headerActions={headerActions}
      >
        <div className="life-app-root">
          {activeTab === 'plan' && <PlanSecondaryNav pathname={location.pathname} navigate={navigate} />}
          <Routes>
            <Route index element={<Navigate to="now" />} />
            <Route path="now" element={<Dashboard />} />
            <Route path="log" element={<LogBrowser />} />
            <Route path="log/:date" element={<LogDayRoute />} />
            <Route path="log/category/:category" element={<LogCategoryRoute />} />
            <Route path="plan" element={<PurposeView />} />
            <Route path="plan/goals" element={<GoalsView onGoalClick={(id) => navigate(`/life/plan/goals/${id}`)} />} />
            <Route path="plan/goals/:goalId" element={<GoalDetailRoute />} />
            <Route path="plan/beliefs" element={<BeliefsView />} />
            <Route path="plan/values" element={<ValuesView />} />
            <Route path="plan/qualities" element={<QualitiesView />} />
            <Route path="plan/ceremonies" element={<CeremonyConfig />} />
            <Route path="ceremony/:type" element={<CeremonyRoute />} />
            {/* Gate on resolved user so agent memory keys to the right person */}
            <Route path="coach" element={lifeUser ? <CoachChat userId={lifeUser.username} /> : null} />
          </Routes>
        </div>
      </AppChrome>
    </LifeUserContext.Provider>
  );
}

const LifeApp = () => (
  <AppThemeProvider pack="life">
    <LifeAppShell />
  </AppThemeProvider>
);

export default LifeApp;
