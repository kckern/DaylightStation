import { Stack, Text, Paper, Group, Badge } from '@mantine/core';
import { useLogActivity } from './shared/useLogActivity.js';
import { ActivityHeatmap } from "./shared/ActivityHeatmap.jsx";
import { LabeledSource } from "./shared/SourceIcon.jsx";
import { EmptyState, LifePage } from "../../components/index.js";
import { LogReadRegion } from './shared/LogReadRegion.jsx';
import { formatLogRangeTitle } from './shared/formatLogRangeTitle.js';
import { formatDate } from "../../lib/format.js";

/**
 * Week view showing a heatmap and per-day summary cards.
 */
export function LogWeekView({ username, at, categories }) {
  const read = useLogActivity({ scope: 'week', username, at, categories });
  if (read.loading || read.error) return <LogReadRegion read={read} />;
  const { days } = read;

  const sortedDates = Object.keys(days).sort().reverse();
  const activeDays = sortedDates.map(date => ({ date, sources: Object.keys(days[date].sources || {}) }))
    .filter(day => day.sources.length > 0);

  const content = (
    <LifePage title={formatLogRangeTitle('Week', read)}>
      <ActivityHeatmap days={days} />

      <Stack gap="sm">
        {activeDays.length === 0 ? (
          <EmptyState title={categories?.length
            ? 'No activity matches the selected categories this week.'
            : 'No activity recorded this week.'}
          />
        ) : activeDays.map(({ date, sources }) => {
          const day = days[date];

          return (
            <Paper key={date} p="sm" withBorder>
              <Group justify="space-between" mb="xs">
                <Text size="sm" fw={500}>{formatDate(date)}</Text>
                <Badge size="sm" variant="light">{sources.length} sources</Badge>
              </Group>
              <Group gap="xs">
                {sources.map(s => (
                  <LabeledSource key={s} source={s} size="sm" />
                ))}
              </Group>
            </Paper>
          );
        })}
      </Stack>
    </LifePage>
  );
  return <LogReadRegion read={read}>{content}</LogReadRegion>;
}
