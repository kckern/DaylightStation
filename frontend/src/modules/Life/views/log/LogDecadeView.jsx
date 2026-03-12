import { Stack, Title, Text, Loader, Paper, Group, Badge, SimpleGrid } from '@mantine/core';
import { useLifelog } from '../../hooks/useLifelog.js';

/**
 * Decade view showing year-by-year summary cards.
 */
export function LogDecadeView({ username, at }) {
  const { data, loading, error } = useLifelog({ scope: 'decade', username, at });

  if (loading) return <Loader size="sm" />;
  if (error) return <Text c="red" size="sm">{error}</Text>;

  const days = data?.days || {};
  const dates = Object.keys(days).sort();

  // Group by year
  const years = {};
  for (const date of dates) {
    const year = date.slice(0, 4);
    if (!years[year]) years[year] = { days: 0, activeDays: 0, sources: new Set() };
    const y = years[year];
    y.days++;
    const sourceCount = Object.keys(days[date].sources || {}).length;
    if (sourceCount > 0) y.activeDays++;
    Object.keys(days[date].sources || {}).forEach(s => y.sources.add(s));
  }

  const yearKeys = Object.keys(years).sort().reverse();

  return (
    <Stack gap="md">
      <Title order={4}>Decade</Title>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
        {yearKeys.map(year => {
          const y = years[year];
          const activeRate = y.days > 0 ? Math.round((y.activeDays / y.days) * 100) : 0;
          return (
            <Paper key={year} p="md" withBorder>
              <Title order={5} mb="xs">{year}</Title>
              <Group gap="xs">
                <Badge size="sm" variant="light">{y.activeDays} active days</Badge>
                <Badge size="sm" variant="light" color="green">{activeRate}% coverage</Badge>
                <Badge size="sm" variant="light" color="blue">{y.sources.size} sources</Badge>
              </Group>
            </Paper>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
