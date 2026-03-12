import { Stack, Title, Text, Loader, Paper, Group, Badge } from '@mantine/core';
import { useLifelog } from '../../hooks/useLifelog.js';
import { SourceIcon } from './shared/SourceIcon.jsx';
import { ActivityHeatmap } from './shared/ActivityHeatmap.jsx';

/**
 * Category-filtered view showing activity for a single extractor category.
 *
 * @param {Object} props
 * @param {string} props.category - extractor category name
 * @param {string} [props.scope] - time scope
 * @param {string} [props.username]
 */
export function LogCategoryView({ category, scope = 'month', username }) {
  const { data, loading, error } = useLifelog({ category, scope, username });

  if (loading) return <Loader size="sm" />;
  if (error) return <Text c="red" size="sm">{error}</Text>;

  const days = data?.days || {};
  const sortedDates = Object.keys(days).sort().reverse();
  const activeDays = sortedDates.filter(d => Object.keys(days[d].sources || {}).length > 0);

  return (
    <Stack gap="md">
      <Group>
        <Title order={4} tt="capitalize">{category}</Title>
        <Badge size="sm" variant="light">{activeDays.length} active days</Badge>
      </Group>

      <ActivityHeatmap days={days} />

      <Stack gap="sm">
        {activeDays.slice(0, 20).map(date => {
          const day = days[date];
          const sources = Object.keys(day.sources || {});
          const summaries = day.summaries || [];

          return (
            <Paper key={date} p="sm" withBorder>
              <Group justify="space-between" mb="xs">
                <Text size="sm" fw={500}>{date}</Text>
                <Group gap="xs">
                  {sources.map(s => (
                    <SourceIcon key={s} source={s} size="sm" />
                  ))}
                </Group>
              </Group>
              {summaries.map((s, i) => (
                <Text key={i} size="xs" c="dimmed">{s.text}</Text>
              ))}
            </Paper>
          );
        })}
      </Stack>
    </Stack>
  );
}
