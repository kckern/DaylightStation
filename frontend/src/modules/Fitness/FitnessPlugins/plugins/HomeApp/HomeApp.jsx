// frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx

import React, { useMemo } from 'react';
import { Grid, Text, Loader } from '@mantine/core';
import { useFitnessContext } from '../../../../../context/FitnessContext.jsx';
import { useDashboardData, parseContentId } from './useDashboardData.js';
import {
  WeightTrendCard,
  NutritionCard,
  WorkoutsCard,
  UpNextCard,
  CoachCard,
} from './DashboardWidgets.jsx';
import { DaylightMediaPath } from '../../../../../lib/api.mjs';
import './HomeApp.scss';

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

  // Goals from agent dashboard (if available)
  const goals = dashboard?.goals || null;

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
      <Grid gutter="md">
        {/* Row 1: Up Next (large) + Coach Card */}
        <Grid.Col span={{ base: 12, md: 7 }}>
          {dashboard?.curated ? (
            <UpNextCard curated={dashboard.curated} onPlay={handlePlay} />
          ) : (
            <div className="dashboard-empty">
              <Text c="dimmed">No workout recommendations yet</Text>
            </div>
          )}
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          {dashboard?.coach ? (
            <CoachCard
              coach={dashboard.coach}
              liveNutrition={liveData?.nutrition}
              onCtaAction={handleCtaAction}
            />
          ) : (
            <div className="dashboard-empty">
              <Text c="dimmed">Coach insights will appear here</Text>
            </div>
          )}
        </Grid.Col>

        {/* Row 2: Stat widgets */}
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <WeightTrendCard weight={liveData?.weight} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <NutritionCard nutrition={liveData?.nutrition} goals={goals} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <WorkoutsCard workouts={liveData?.workouts} />
        </Grid.Col>
      </Grid>
    </div>
  );
};

export default HomeApp;
