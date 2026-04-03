import React from 'react';
import { Text, Stack, Paper, Progress, Group, Badge } from '@mantine/core';

export default function GoalsDetail({ goals }) {
  if (!goals?.length) {
    return <Text c="dimmed" py="md">No active goals</Text>;
  }

  return (
    <Stack gap="md" mt="md">
      {goals.map(goal => {
        const metric = goal.metrics?.[0];
        const pct = metric?.target > 0
          ? Math.min(100, Math.round((metric.current / metric.target) * 100))
          : 0;

        return (
          <Paper key={goal.id} p="md" radius="sm" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <Group justify="space-between" mb="xs">
              <Text size="sm" fw={600}>{goal.name}</Text>
              <Badge color={goal.state === 'committed' ? 'blue' : 'gray'} variant="light" size="sm">
                {goal.state}
              </Badge>
            </Group>
            {metric && (
              <>
                <Group justify="space-between" mb={4}>
                  <Text size="xs" c="dimmed">{metric.name}</Text>
                  <Text size="xs" c="dimmed">{metric.current} / {metric.target}</Text>
                </Group>
                <Progress value={pct} size="md" color={pct >= 100 ? 'green' : 'blue'} />
              </>
            )}
            {goal.deadline && (
              <Text size="xs" c="dimmed" mt="xs">
                Deadline: {new Date(goal.deadline).toLocaleDateString()}
              </Text>
            )}
          </Paper>
        );
      })}
    </Stack>
  );
}
