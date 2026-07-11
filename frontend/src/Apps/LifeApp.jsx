import React, { useMemo, useEffect } from 'react';
import { MantineProvider, AppShell, NavLink, Title, Group, Text, Select } from '@mantine/core';
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import { IconDashboard, IconTimeline, IconTarget, IconHeart, IconBrain, IconDiamond, IconShield, IconCalendarEvent, IconMessageCircle } from '@tabler/icons-react';
import '@mantine/core/styles.css';
import { configure } from '../lib/logging/Logger.js';
import { getChildLogger } from '../lib/logging/singleton.js';
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

const PlaceholderView = ({ title }) => (
  <div style={{ padding: '2rem' }}>
    <Title order={3}>{title}</Title>
    <Text c="dimmed" mt="sm">Coming soon</Text>
  </div>
);

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

const LifeApp = () => {
  useDocumentTitle('Life');
  const logger = useMemo(() => getChildLogger({ app: 'life' }), []);
  const navigate = useNavigate();
  const location = useLocation();
  const { user: lifeUser, users: lifeUsers, setUsername } = useLifeUser();

  // Enable session file logging — writes to media/logs/life/<timestamp>.jsonl
  useEffect(() => {
    configure({ context: { app: 'life', sessionLog: true } });
    logger.info('life.app.mounted');
    return () => {
      logger.info('life.app.unmounted');
      configure({ context: { sessionLog: false } });
    };
  }, [logger]);

  // Log route changes
  useEffect(() => {
    logger.info('life.route.changed', { path: location.pathname });
  }, [location.pathname, logger]);

  const isActive = (path) => location.pathname.startsWith(`/life/${path}`);

  return (
    <MantineProvider>
      <LifeUserContext.Provider value={lifeUser}>
      <AppShell
        header={{ height: 48 }}
        navbar={{ width: 200, breakpoint: 'sm' }}
        padding="md"
      >
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between">
            <Title order={4}>Life</Title>
            {/* User switcher — only meaningful in a multi-member household. */}
            {lifeUsers.length > 1 && (
              <Select
                size="xs"
                w={150}
                aria-label="Switch household member"
                allowDeselect={false}
                data={lifeUsers.map((u) => ({ value: u.username, label: u.displayName }))}
                value={lifeUser?.username || null}
                onChange={(val) => { if (val) setUsername(val); }}
              />
            )}
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="xs">
          <NavLink
            label="Now"
            leftSection={<IconDashboard size={16} />}
            active={isActive('now')}
            onClick={() => navigate('/life/now')}
          />
          <NavLink
            label="Log"
            leftSection={<IconTimeline size={16} />}
            active={isActive('log')}
            onClick={() => navigate('/life/log')}
          />
          <NavLink
            label="Plan"
            leftSection={<IconTarget size={16} />}
            active={isActive('plan')}
            defaultOpened={isActive('plan')}
          >
            <NavLink label="Purpose" leftSection={<IconHeart size={14} />} active={location.pathname === '/life/plan'} onClick={() => navigate('/life/plan')} />
            <NavLink label="Goals" leftSection={<IconTarget size={14} />} active={isActive('plan/goals')} onClick={() => navigate('/life/plan/goals')} />
            <NavLink label="Beliefs" leftSection={<IconBrain size={14} />} active={isActive('plan/beliefs')} onClick={() => navigate('/life/plan/beliefs')} />
            <NavLink label="Values" leftSection={<IconDiamond size={14} />} active={isActive('plan/values')} onClick={() => navigate('/life/plan/values')} />
            <NavLink label="Qualities" leftSection={<IconShield size={14} />} active={isActive('plan/qualities')} onClick={() => navigate('/life/plan/qualities')} />
            <NavLink label="Ceremonies" leftSection={<IconCalendarEvent size={14} />} active={isActive('plan/ceremonies')} onClick={() => navigate('/life/plan/ceremonies')} />
          </NavLink>
          <NavLink
            label="Coach"
            leftSection={<IconMessageCircle size={16} />}
            active={isActive('coach')}
            onClick={() => navigate('/life/coach')}
          />
        </AppShell.Navbar>

        <AppShell.Main>
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
        </AppShell.Main>
      </AppShell>
      </LifeUserContext.Provider>
    </MantineProvider>
  );
};

export default LifeApp;
