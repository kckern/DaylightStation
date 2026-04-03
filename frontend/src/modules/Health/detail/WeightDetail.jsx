import React from 'react';
import { Text, Stack, Group, Paper } from '@mantine/core';

export default function WeightDetail({ dashboard }) {
  const history = dashboard?.history?.daily || [];
  const recent = history
    .filter(d => d.weight?.lbs != null)
    .slice(0, 14);

  if (!recent.length) {
    return <Text c="dimmed" py="md">No recent weight data</Text>;
  }

  return (
    <Stack gap="xs" mt="md">
      <Text size="sm" fw={600} c="dimmed" tt="uppercase">Recent Readings</Text>
      {recent.map(day => (
        <Paper key={day.date} p="xs" radius="sm" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <Group justify="space-between">
            <Text size="sm">{day.date}</Text>
            <Group gap="sm">
              <Text size="sm" fw={600}>{day.weight.lbs?.toFixed(1)} lbs</Text>
              {day.weight.trend != null && (
                <Text size="xs" c={day.weight.trend < 0 ? 'green' : day.weight.trend > 0 ? 'red' : 'dimmed'}>
                  {day.weight.trend > 0 ? '+' : ''}{day.weight.trend?.toFixed(2)}
                </Text>
              )}
            </Group>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}
