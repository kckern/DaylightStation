import React from 'react';
import { Text, Title, Stack, Badge, Skeleton } from '@mantine/core';
import { useScreenData } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { DashboardCard } from '../_shared/DashboardCard.jsx';

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

  if (!weight || weight.current == null) {
    return (
      <DashboardCard title="Weight" className="dashboard-card--weight">
        <Text c="dimmed" ta="center" py="md">No weight data</Text>
      </DashboardCard>
    );
  }

  const trendArrow = weight.trend7d < 0 ? '\u2193' : weight.trend7d > 0 ? '\u2191' : '\u2192';
  const trendColor = weight.trend7d < 0 ? 'green' : weight.trend7d > 0 ? 'red' : 'gray';

  return (
    <DashboardCard title="Weight" className="dashboard-card--weight">
      <Stack gap={4} align="center">
        <Title order={2} className="dashboard-stat-value">
          {weight.current.toFixed(1)}
        </Title>
        <Text size="sm" c="dimmed">lbs</Text>
        {weight.trend7d != null && (
          <Badge color={trendColor} variant="light" size="lg">
            {trendArrow} {Math.abs(weight.trend7d).toFixed(1)} lbs / 7d
          </Badge>
        )}
        {weight.fatPercent != null && (
          <Text size="xs" c="dimmed">{weight.fatPercent.toFixed(1)}% body fat</Text>
        )}
      </Stack>
    </DashboardCard>
  );
}
