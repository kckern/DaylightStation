import React from 'react';
import { Text, Title, Stack, Group, Badge } from '@mantine/core';
import { DashboardCard } from '../../Fitness/widgets/_shared/DashboardCard';

export default function SessionsCard({ sessions, onClick }) {
  const count = sessions?.length || 0;
  const totalCoins = sessions?.reduce((t, s) => t + (s.totalCoins || 0), 0) || 0;
  const latest = sessions?.[0];

  return (
    <DashboardCard title="Sessions" icon="🏋️" onClick={onClick}>
      <Stack gap={4} align="center">
        <Title order={2} className="dashboard-stat-value">{count}</Title>
        <Text size="sm" c="dimmed">today</Text>
        {totalCoins > 0 && (
          <Badge color="yellow" variant="light" size="lg">
            🪙 {totalCoins}
          </Badge>
        )}
        {latest?.title && (
          <Text size="xs" c="dimmed" ta="center" lineClamp={1}>
            {latest.showTitle ? `${latest.showTitle}: ` : ''}{latest.title}
          </Text>
        )}
      </Stack>
    </DashboardCard>
  );
}
