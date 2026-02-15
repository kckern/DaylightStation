// frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx

import React, { useMemo, Component } from 'react';
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
    <div className="health-dashboard">
      <DashboardErrorBoundary>
        <Grid gutter="md">
          {/* Row 1: Recent Sessions (expand if no curated data) */}
          <Grid.Col span={{ base: 12, md: dashboard?.curated ? 7 : 12 }}>
            <WorkoutsCard sessions={liveData?.sessions} />
          </Grid.Col>
          {dashboard?.curated && (
            <Grid.Col span={{ base: 12, md: 5 }}>
              <UpNextCard curated={dashboard.curated} onPlay={handlePlay} />
            </Grid.Col>
          )}

          {/* Row 2: Weight + Nutrition (expand if no coach) */}
          <Grid.Col span={{ base: 12, md: 4 }}>
            <WeightTrendCard weight={liveData?.weight} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: dashboard?.coach ? 4 : 8 }}>
            <NutritionCard nutrition={liveData?.nutrition} />
          </Grid.Col>
          {dashboard?.coach && (
            <Grid.Col span={{ base: 12, md: 4 }}>
              <CoachCard
                coach={dashboard.coach}
                liveNutrition={liveData?.nutrition}
                onCtaAction={handleCtaAction}
              />
            </Grid.Col>
          )}
        </Grid>
      </DashboardErrorBoundary>
    </div>
  );
};

export default HomeApp;
