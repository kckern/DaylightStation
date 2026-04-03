import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MantineProvider, Skeleton } from '@mantine/core';
import '@mantine/core/styles.css';
import './HealthApp.scss';
import { DaylightAPI } from '../lib/api.mjs';
import { getChildLogger } from '../lib/logging/singleton.js';
import HealthHub from '../modules/Health/HealthHub';
import HealthDetail from '../modules/Health/HealthDetail';

const HealthApp = () => {
  const logger = useMemo(() => getChildLogger({ app: 'health' }), []);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('hub');
  const [detailType, setDetailType] = useState(null);

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
      </div>
    </MantineProvider>
  );
};

export default HealthApp;
