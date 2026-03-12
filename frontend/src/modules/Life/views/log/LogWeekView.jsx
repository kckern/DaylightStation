import { Stack, Title, Text, Loader, Paper, Group, Badge } from '@mantine/core';
import { useLifelog } from '../../hooks/useLifelog.js';
import { ActivityHeatmap } from './shared/ActivityHeatmap.jsx';
import { SourceIcon } from './shared/SourceIcon.jsx';

/**
 * Week view showing a heatmap and per-day summary cards.
 */
export function LogWeekView({ username, at }) {
  const { data, loading, error } = useLifelog({ scope: 'week', username, at });

  if (loading) return <Loader size="sm" />;
  if (error) return <Text c="red" size="sm">{error}</Text>;

  const days = data?.days || {};
  const sortedDates = Object.keys(days).sort().reverse();

  return (
    <Stack gap="md">
      <Title order={4}>This Week</Title>
      <ActivityHeatmap days={days} />

      <Stack gap="sm">
        {sortedDates.map(date => {
          const day = days[date];
          const sources = Object.keys(day.sources || {});
          if (sources.length === 0) return null;

          return (
            <Paper key={date} p="sm" withBorder>
              <Group justify="space-between" mb="xs">
                <Text size="sm" fw={500}>{date}</Text>
                <Badge size="sm" variant="light">{sources.length} sources</Badge>
              </Group>
              <Group gap="xs">
                {sources.map(s => (
                  <SourceIcon key={s} source={s} size="sm" />
                ))}
              </Group>
            </Paper>
          );
        })}
      </Stack>
    </Stack>
  );
}
