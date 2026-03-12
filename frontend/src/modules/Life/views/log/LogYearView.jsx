import { Stack, Title, Text, Loader, Paper, Group, Badge, SimpleGrid } from '@mantine/core';
import { useLifelog } from '../../hooks/useLifelog.js';
import { ActivityHeatmap } from './shared/ActivityHeatmap.jsx';

/**
 * Year view with full-year heatmap and quarterly summary cards.
 */
export function LogYearView({ username, at }) {
  const { data, loading, error } = useLifelog({ scope: 'year', username, at });

  if (loading) return <Loader size="sm" />;
  if (error) return <Text c="red" size="sm">{error}</Text>;

  const days = data?.days || {};
  const dates = Object.keys(days).sort();

  // Group by quarter
  const quarters = {};
  for (const date of dates) {
    const month = parseInt(date.slice(5, 7), 10);
    const q = Math.ceil(month / 3);
    const year = date.slice(0, 4);
    const qKey = `${year} Q${q}`;
    if (!quarters[qKey]) quarters[qKey] = { days: 0, sources: new Set(), activeDays: 0 };
    const qr = quarters[qKey];
    qr.days++;
    const sourceCount = Object.keys(days[date].sources || {}).length;
    if (sourceCount > 0) qr.activeDays++;
    Object.keys(days[date].sources || {}).forEach(s => qr.sources.add(s));
  }

  const qKeys = Object.keys(quarters).sort().reverse();

  return (
    <Stack gap="md">
      <Title order={4}>This Year</Title>
      <ActivityHeatmap days={days} />

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {qKeys.map(qKey => {
          const q = quarters[qKey];
          const activeRate = q.days > 0 ? Math.round((q.activeDays / q.days) * 100) : 0;
          return (
            <Paper key={qKey} p="sm" withBorder>
              <Title order={6} mb="xs">{qKey}</Title>
              <Group gap="xs">
                <Badge size="sm" variant="light">{q.activeDays}/{q.days} active days</Badge>
                <Badge size="sm" variant="light" color="green">{activeRate}%</Badge>
                <Badge size="sm" variant="light" color="blue">{q.sources.size} sources</Badge>
              </Group>
            </Paper>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
