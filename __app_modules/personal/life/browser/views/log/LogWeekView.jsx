import { Stack, Text, Paper, Group, Badge } from '@mantine/core';
import { useLogActivity } from './shared/useLogActivity.js';
import { ActivityHeatmap } from "./shared/ActivityHeatmap.jsx";
import { SourceIcon } from "./shared/SourceIcon.jsx";
import { LifePage, LoadingState, ErrorState } from "../../components/index.js";
import { formatDate } from "../../lib/format.js";

/**
 * Week view showing a heatmap and per-day summary cards.
 */
export function LogWeekView({ username, at, categories }) {
  const { days, loading, error, refetch } = useLogActivity({ scope: 'week', username, at, categories });

  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const sortedDates = Object.keys(days).sort().reverse();

  return (
    <LifePage title="This Week">
      <ActivityHeatmap days={days} />

      <Stack gap="sm">
        {sortedDates.map(date => {
          const day = days[date];
          const sources = Object.keys(day.sources || {});
          if (sources.length === 0) return null;

          return (
            <Paper key={date} p="sm" withBorder>
              <Group justify="space-between" mb="xs">
                <Text size="sm" fw={500}>{formatDate(date)}</Text>
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
    </LifePage>
  );
}
