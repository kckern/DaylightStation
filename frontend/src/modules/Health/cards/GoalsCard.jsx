import React from 'react';
import { Text, Stack, Progress, Group } from '@mantine/core';
import { DashboardCard } from '../../Fitness/widgets/_shared/DashboardCard';

export default function GoalsCard({ goals, onClick }) {
  if (!goals?.length) {
    return (
      <DashboardCard title="Goals" icon="🎯" onClick={onClick}>
        <Text c="dimmed" ta="center" py="md">No active goals</Text>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard title="Goals" icon="🎯" onClick={onClick}>
      <Stack gap="sm">
        {goals.map((goal) => {
          const metric = goal.metrics?.[0];
          const pct = metric?.target > 0
            ? Math.min(100, Math.round((metric.current / metric.target) * 100))
            : 0;

          return (
            <div key={goal.id}>
              <Group justify="space-between" mb={4}>
                <Text size="xs" fw={500} lineClamp={1} style={{ flex: 1 }}>
                  {goal.name}
                </Text>
                {metric && (
                  <Text size="xs" c="dimmed">
                    {metric.current}/{metric.target}
                  </Text>
                )}
              </Group>
              <Progress value={pct} size="sm" color={pct >= 100 ? 'green' : 'blue'} />
            </div>
          );
        })}
      </Stack>
    </DashboardCard>
  );
}
