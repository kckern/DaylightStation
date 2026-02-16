// frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx

import React, { useMemo, useState, useEffect, Component } from 'react';
import { Grid, Text, Loader } from '@mantine/core';
import { useFitnessContext } from '@/context/FitnessContext.jsx';
import { useDashboardData, parseContentId } from './useDashboardData.js';
import {
  NutritionCard,
  WorkoutsCard,
  WeightTrendCard,
  UpNextCard,
  CoachCard,
} from './DashboardWidgets.jsx';
import FitnessChartApp from '../FitnessChartApp/FitnessChartApp.jsx';
import { DaylightMediaPath } from '@/lib/api.mjs';
import './HomeApp.scss';

class DashboardErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="dashboard-empty">
          <Text size="lg" c="red">Dashboard error</Text>
          <Text size="sm" c="dimmed">{this.state.error?.message}</Text>
          <Text
            size="sm"
            c="blue"
            mt="md"
            style={{ cursor: 'pointer' }}
            onPointerDown={() => this.setState({ hasError: false })}
          >
            Tap to retry
          </Text>
        </div>
      );
    }
    return this.props.children;
  }
}

const HomeApp = () => {
  // Access fitness context directly via the hook (same pattern as VibrationApp)
  const fitnessCtx = useFitnessContext();

  // Determine userId from fitness config (head of household)
  const userId = useMemo(() => {
    const users = fitnessCtx?.fitnessConfiguration?.fitness?.users;
    const primary = users?.primary;
    if (Array.isArray(primary) && primary.length > 0) {
      return primary[0].name || primary[0].username || primary[0].id;
    }
    return null;
  }, [fitnessCtx?.fitnessConfiguration]);

  const { loading, error, dashboard, liveData, refetch } = useDashboardData(userId);

  // Session detail state
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [sessionDetail, setSessionDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    fetch(`/api/v1/fitness/sessions/${selectedSessionId}`)
      .then(res => res.ok ? res.json() : Promise.reject(new Error('Failed to fetch session')))
      .then(data => { if (!cancelled) setSessionDetail(data.session); })
      .catch(err => console.error('Failed to fetch session detail', err))
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedSessionId]);

  // Play handler -- adds content to fitness play queue
  const handlePlay = (contentItem) => {
    if (!contentItem?.content_id) return;
    const { source, localId } = parseContentId(contentItem.content_id);
    const queueItem = {
      id: localId,
      contentSource: source,
      type: 'episode',
      title: contentItem.title,
      videoUrl: DaylightMediaPath(`api/v1/play/${source}/${localId}`),
      image: DaylightMediaPath(`api/v1/display/${source}/${localId}`),
      duration: contentItem.duration,
    };
    fitnessCtx?.setFitnessPlayQueue?.(prev => [...prev, queueItem]);
  };

  // CTA action handler
  const handleCtaAction = (cta) => {
    console.log('CTA action:', cta.action, cta.message);
  };

  if (!userId) {
    return (
      <div className="dashboard-empty">
        <Text c="dimmed">No user profile configured</Text>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="dashboard-loading">
        <Loader color="blue" size="lg" />
      </div>
    );
  }

  if (error && !liveData) {
    return (
      <div className="dashboard-empty">
        <Text size="lg" c="red">{error}</Text>
        <Text
          size="sm"
          c="dimmed"
          mt="sm"
          style={{ cursor: 'pointer' }}
          onPointerDown={refetch}
        >
          Tap to retry
        </Text>
      </div>
    );
  }

  return (
    <div className="home-app">
      <DashboardErrorBoundary>
        <div className={`dashboard-grid${selectedSessionId ? ' dashboard-grid--detail' : ''}`}>
          {/* Column 1: History */}
          <div className="dashboard-column column-history">
            <WorkoutsCard
              sessions={liveData?.sessions}
              onSessionClick={setSelectedSessionId}
              selectedSessionId={selectedSessionId}
            />
          </div>

          {selectedSessionId ? (
            /* Detail view: FitnessChartApp */
            <div className="dashboard-column detail-panel">
              <div
                className="detail-panel__close"
                role="button"
                tabIndex={0}
                onPointerDown={() => setSelectedSessionId(null)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedSessionId(null); }}
              >
                <Text size="sm" fw={500}>Back to dashboard</Text>
              </div>
              {detailLoading ? (
                <div className="dashboard-loading"><Loader color="blue" size="lg" /></div>
              ) : sessionDetail ? (
                <FitnessChartApp
                  sessionData={sessionDetail}
                  mode="standalone"
                  onClose={() => setSelectedSessionId(null)}
                />
              ) : (
                <div className="dashboard-empty">
                  <Text c="dimmed">Session data unavailable</Text>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Column 2: Metrics (1/3) */}
              <div className="dashboard-column column-metrics">
                <WeightTrendCard weight={liveData?.weight} />
                <NutritionCard nutrition={liveData?.nutrition} />
              </div>

              {/* Column 3: Interactions (1/3) */}
              <div className="dashboard-column column-interactions">
                {dashboard?.curated && (
                  <UpNextCard curated={dashboard.curated} onPlay={handlePlay} />
                )}
                {dashboard?.coach && (
                  <CoachCard
                    coach={dashboard.coach}
                    liveNutrition={liveData?.nutrition}
                    onCtaAction={handleCtaAction}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </DashboardErrorBoundary>
    </div>
  );
};

export default HomeApp;
