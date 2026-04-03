import React from 'react';
import { Text, Title, Stack, Badge } from '@mantine/core';
import { DashboardCard } from '../../Fitness/widgets/_shared/DashboardCard';

export default function WeightCard({ weight, recency, onClick }) {
  if (!weight) {
    return (
      <DashboardCard title="Weight" icon="⚖️" onClick={onClick}>
        <Text c="dimmed" ta="center" py="md">No weight data</Text>
      </DashboardCard>
    );
  }

  const trend = weight.trend;
  const trendArrow = trend < 0 ? '↓' : trend > 0 ? '↑' : '→';
  const trendColor = trend < 0 ? 'green' : trend > 0 ? 'red' : 'gray';
  const daysAgo = recency?.daysSince;

  return (
    <DashboardCard title="Weight" icon="⚖️" onClick={onClick}>
      <Stack gap={4} align="center">
        <Title order={2} className="dashboard-stat-value">
          {weight.lbs?.toFixed(1)}
        </Title>
        <Text size="sm" c="dimmed">lbs</Text>
        {trend != null && (
          <Badge color={trendColor} variant="light" size="lg">
            {trendArrow} {Math.abs(trend).toFixed(2)} / day
          </Badge>
        )}
        {daysAgo != null && (
          <Text size="xs" c="dimmed">
            {daysAgo === 0 ? 'Today' : `${daysAgo}d ago`}
          </Text>
        )}
      </Stack>
    </DashboardCard>
  );
}
