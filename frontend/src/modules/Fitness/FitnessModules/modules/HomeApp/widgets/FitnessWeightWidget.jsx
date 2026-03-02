import React from 'react';
import { useScreenData } from '../../../../../../screen-framework/data/ScreenDataProvider.jsx';
import { WeightTrendCard } from '../DashboardWidgets.jsx';
import { Skeleton } from '@mantine/core';

function parseWeightData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const dates = Object.keys(raw).sort().reverse();
  if (!dates.length) return null;
  const latest = raw[dates[0]];
  return {
    current: latest.lbs_adjusted_average || latest.lbs,
    fatPercent: latest.fat_percent_average || latest.fat_percent,
    trend7d: latest.lbs_adjusted_average_7day_trend || null,
  };
}

export default function FitnessWeightWidget() {
  const rawWeight = useScreenData('weight');
  if (!rawWeight) return <Skeleton height={120} />;
  const weight = parseWeightData(rawWeight);
  return <WeightTrendCard weight={weight} />;
}
