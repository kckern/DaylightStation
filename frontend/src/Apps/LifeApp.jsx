import React, { useMemo } from 'react';
import { MantineProvider, AppShell, NavLink, Title, Group, Text } from '@mantine/core';
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import '@mantine/core/styles.css';
import { getChildLogger } from '../lib/logging/singleton.js';
import { Dashboard } from '../modules/Life/views/now/Dashboard.jsx';
import { LogBrowser } from '../modules/Life/views/log/LogBrowser.jsx';
import { LogDayDetail } from '../modules/Life/views/log/LogDayDetail.jsx';
import { LogCategoryView } from '../modules/Life/views/log/LogCategoryView.jsx';

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

const LifeApp = () => {
  const logger = useMemo(() => getChildLogger({ app: 'life' }), []);
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path) => location.pathname.startsWith(`/life/${path}`);

  return (
    <MantineProvider>
      <AppShell
        header={{ height: 48 }}
        navbar={{ width: 200, breakpoint: 'sm' }}
        padding="md"
      >
        <AppShell.Header>
          <Group h="100%" px="md">
            <Title order={4}>Life</Title>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="xs">
          <NavLink
            label="Now"
            active={isActive('now')}
            onClick={() => navigate('/life/now')}
          />
          <NavLink
            label="Log"
            active={isActive('log')}
            onClick={() => navigate('/life/log')}
          />
          <NavLink
            label="Plan"
            active={isActive('plan')}
            onClick={() => navigate('/life/plan')}
          />
        </AppShell.Navbar>

        <AppShell.Main>
          <Routes>
            <Route index element={<Navigate to="now" />} />
            <Route path="now" element={<Dashboard />} />
            <Route path="log" element={<LogBrowser />} />
            <Route path="log/:date" element={<LogDayRoute />} />
            <Route path="log/category/:category" element={<LogCategoryRoute />} />
            <Route path="plan" element={<PlaceholderView title="Plan — Life Plan Overview" />} />
            <Route path="plan/goals" element={<PlaceholderView title="Goals" />} />
            <Route path="plan/beliefs" element={<PlaceholderView title="Beliefs" />} />
            <Route path="plan/values" element={<PlaceholderView title="Values" />} />
            <Route path="plan/qualities" element={<PlaceholderView title="Qualities" />} />
            <Route path="plan/ceremonies" element={<PlaceholderView title="Ceremonies" />} />
            <Route path="ceremony/:type" element={<PlaceholderView title="Ceremony Flow" />} />
          </Routes>
        </AppShell.Main>
      </AppShell>
    </MantineProvider>
  );
};

export default LifeApp;
