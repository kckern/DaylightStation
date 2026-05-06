import { useState, useEffect, useMemo, useCallback } from 'react';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import './HealthApp.scss';
import { DaylightAPI } from '../lib/api.mjs';
import { getChildLogger } from '../lib/logging/singleton.js';
import HealthHub from '../modules/Health/HealthHub';
import HealthDetail from '../modules/Health/HealthDetail';
import CoachChat from '../modules/Health/CoachChat';
import { AskBar } from '../modules/Health/AskBar/index.jsx';
import { ChatOverlay } from '../modules/Health/ChatOverlay/index.jsx';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import { healthTheme } from './HealthApp.theme.js';

const HealthApp = () => {
  useDocumentTitle('Health');
  const logger = useMemo(() => getChildLogger({ app: 'health' }), []);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailType, setDetailType] = useState(null);
  const [overlayOpen, setOverlayOpen] = useState(false);

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

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  // ⌘K / Ctrl+K opens the chat overlay from anywhere
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOverlayOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const openDetail = useCallback((type) => setDetailType(type), []);
  const backToHub = useCallback(() => setDetailType(null), []);

  return (
    <MantineProvider theme={healthTheme} defaultColorScheme="dark">
      <div className="health-app">
        <header className="health-app__header">
          <div className="health-app__header-left">
            <span className="health-app__status-dot" />
            <span>Health · {userId}</span>
          </div>
          <div className="health-app__header-right">
            {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
        </header>

        {detailType
          ? <HealthDetail type={detailType} dashboard={dashboard} onBack={backToHub} />
          : <HealthHub dashboard={dashboard} loading={loading} onCardClick={openDetail} onRefresh={fetchDashboard} />
        }

        <AskBar onActivate={() => setOverlayOpen(true)} />

        <ChatOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} userId={userId}>
          <CoachChat userId={userId} variant="overlay" />
        </ChatOverlay>
      </div>
    </MantineProvider>
  );
};

export default HealthApp;
