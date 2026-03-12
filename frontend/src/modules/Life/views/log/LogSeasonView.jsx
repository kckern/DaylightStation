import { Stack, Title, Text, Loader, Paper, Group, Badge, SimpleGrid } from '@mantine/core';
import { useLifelog } from '../../hooks/useLifelog.js';
import { ActivityHeatmap } from './shared/ActivityHeatmap.jsx';

/**
 * Season (90-day) view with heatmap and monthly summary cards.
 */
export function LogSeasonView({ username, at }) {
  const { data, loading, error } = useLifelog({ scope: 'season', username, at });

  if (loading) return <Loader size="sm" />;
  if (error) return <Text c="red" size="sm">{error}</Text>;

  const days = data?.days || {};
  const dates = Object.keys(days).sort();

  // Group by month
  const months = {};
  for (const date of dates) {
    const monthKey = date.slice(0, 7); // YYYY-MM
    if (!months[monthKey]) months[monthKey] = { days: 0, sources: new Set(), summaryCount: 0 };
    const m = months[monthKey];
    m.days++;
    Object.keys(days[date].sources || {}).forEach(s => m.sources.add(s));
    m.summaryCount += (days[date].summaries || []).length;
  }

  const monthKeys = Object.keys(months).sort().reverse();

  return (
    <Stack gap="md">
      <Title order={4}>This Season</Title>
      <ActivityHeatmap days={days} />

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
        {monthKeys.map(monthKey => {
          const m = months[monthKey];
          return (
            <Paper key={monthKey} p="sm" withBorder>
              <Title order={6} mb="xs">{monthKey}</Title>
              <Group gap="xs">
                <Badge size="sm" variant="light">{m.days} days</Badge>
                <Badge size="sm" variant="light" color="green">{m.sources.size} sources</Badge>
                <Badge size="sm" variant="light" color="blue">{m.summaryCount} entries</Badge>
              </Group>
            </Paper>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
