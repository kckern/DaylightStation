import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MantineProvider, Skeleton, Tabs } from '@mantine/core';
import { IconLayoutDashboard, IconMessageCircle } from '@tabler/icons-react';
import '@mantine/core/styles.css';
import './HealthApp.scss';
import { DaylightAPI } from '../lib/api.mjs';
import { getChildLogger } from '../lib/logging/singleton.js';
import HealthHub from '../modules/Health/HealthHub';
import HealthDetail from '../modules/Health/HealthDetail';
import CoachChat from '../modules/Health/CoachChat';
import useDocumentTitle from '../hooks/useDocumentTitle.js';

const HealthApp = () => {
  useDocumentTitle('Health');
  const logger = useMemo(() => getChildLogger({ app: 'health' }), []);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('hub');
  const [detailType, setDetailType] = useState(null);
  const [topTab, setTopTab] = useState('hub');

  // Replace 'default' with the actual head-of-household lookup if available
  // via existing app config. For v1, derive userId from a window-level config
  // if present; fall back to 'default'.
  const userId = useMemo(() =>
    (typeof window !== 'undefined' && window.DAYLIGHT_USER_ID) || 'default',
    []
  );

  const fetchDashboard = useCallback(async () => {
    try {
      const data = await DaylightAPI('/api/v1/health/dashboard');
      setDashboard(data);
    } catch (err) {
      logger.error('health.dashboard.fetch.failed', { error: err?.message });
    } finally {
      setLoading(false);
    }
  }, [logger]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const openDetail = useCallback((type) => {
    setDetailType(type);
    setView('detail');
  }, []);

  const backToHub = useCallback(() => {
    setView('hub');
    setDetailType(null);
  }, []);

  if (loading) {
    return (
      <MantineProvider>
        <div className="health-app">
          <Skeleton height={200} mb="md" />
          <Skeleton height={200} mb="md" />
        </div>
      </MantineProvider>
    );
  }

  return (
    <MantineProvider>
      <div className="health-app">
        <Tabs value={topTab} onChange={setTopTab} variant="outline">
          <Tabs.List>
            <Tabs.Tab value="hub" leftSection={<IconLayoutDashboard size={14} />}>Hub</Tabs.Tab>
            <Tabs.Tab value="coach" leftSection={<IconMessageCircle size={14} />}>Coach</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="hub" pt="sm">
            {view === 'hub' ? (
              <HealthHub
                dashboard={dashboard}
                onCardClick={openDetail}
                onRefresh={fetchDashboard}
              />
            ) : (
              <HealthDetail
                type={detailType}
                dashboard={dashboard}
                onBack={backToHub}
              />
            )}
          </Tabs.Panel>

          <Tabs.Panel value="coach" pt="sm">
            <div className="health-app__coach-pane">
              <CoachChat userId={userId} />
            </div>
          </Tabs.Panel>
        </Tabs>
      </div>
    </MantineProvider>
  );
};

export default HealthApp;
