import React from 'react';
import { Text, Stack, Group, Paper, Badge } from '@mantine/core';

export default function SessionsDetail({ dashboard }) {
  const sessions = dashboard?.today?.sessions || [];
  const history = dashboard?.history?.daily || [];
  const recentWithSessions = history.filter(d =>
    (Array.isArray(d.workouts) && d.workouts.length > 0) ||
    (d.sessions?.count > 0)
  ).slice(0, 14);

  return (
    <Stack gap="md" mt="md">
      {sessions.length > 0 && (
        <div>
          <Text size="sm" fw={600} c="dimmed" tt="uppercase" mb="xs">Today</Text>
          {sessions.map(s => (
            <Paper key={s.sessionId} p="sm" radius="sm" mb={4} style={{ background: 'rgba(255,255,255,0.03)' }}>
              <Group justify="space-between">
                <div>
                  <Text size="sm" fw={500}>{s.title}</Text>
                  {s.showTitle && <Text size="xs" c="dimmed">{s.showTitle}</Text>}
                </div>
                <Group gap="xs">
                  <Badge color="blue" variant="light" size="sm">
                    {Math.round((s.durationMs || 0) / 60000)} min
                  </Badge>
                  {s.totalCoins > 0 && (
                    <Badge color="yellow" variant="light" size="sm">🪙 {s.totalCoins}</Badge>
                  )}
                </Group>
              </Group>
            </Paper>
          ))}
        </div>
      )}

      <div>
        <Text size="sm" fw={600} c="dimmed" tt="uppercase" mb="xs">Recent Activity</Text>
        {recentWithSessions.map(day => (
          <Paper key={day.date} p="xs" radius="sm" mb={4} style={{ background: 'rgba(255,255,255,0.03)' }}>
            <Group justify="space-between">
              <Text size="sm">{day.date}</Text>
              <Text size="xs" c="dimmed">
                {Array.isArray(day.workouts) ? `${day.workouts.length} workouts` : ''}
              </Text>
            </Group>
          </Paper>
        ))}
      </div>
    </Stack>
  );
}
