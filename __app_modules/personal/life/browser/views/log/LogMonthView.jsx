import { Stack, Text, Paper, Group, Badge } from '@mantine/core';
import { useLogActivity } from './shared/useLogActivity.js';
import { ActivityHeatmap } from "./shared/ActivityHeatmap.jsx";
import { LifePage } from "../../components/index.js";
import { LogReadRegion } from './shared/LogReadRegion.jsx';
import { formatLogRangeTitle } from './shared/formatLogRangeTitle.js';
import { summarizeActivityDays } from './shared/summarizeActivityDays.js';
import { formatDate } from "../../lib/format.js";
import { startOfCalendarWeek } from '@/lib/calendarDay.js';

/**
 * Month view with heatmap and weekly summary rows.
 */
export function LogMonthView({ username, at, categories }) {
  const read = useLogActivity({ scope: 'month', username, at, categories });
  if (read.loading || read.error) return <LogReadRegion read={read} />;
  const { days } = read;

  const dates = Object.keys(days).sort();

  // Group by week (ISO week)
  const weeks = {};
  for (const date of dates) {
    const weekKey = startOfCalendarWeek(date, 1);
    if (!weeks[weekKey]) weeks[weekKey] = {};
    weeks[weekKey][date] = days[date];
  }

  const weekKeys = Object.keys(weeks).sort().reverse();

  const content = (
    <LifePage title={formatLogRangeTitle('Month', read)}>
      <ActivityHeatmap days={days} weekStartsOn={1} />

      <Stack gap="sm">
        {weekKeys.map(weekKey => {
          const summary = summarizeActivityDays(weeks[weekKey]);

          return (
            <Paper key={weekKey} p="sm" withBorder>
              <Group justify="space-between">
                <Text size="sm" fw={500}>Week of {formatDate(weekKey)}</Text>
                <Group gap="xs">
                  <Badge size="sm" variant="light">{summary.activeDayCount} of {summary.dayCount} days active</Badge>
                  <Badge size="sm" variant="light" color="green">{summary.distinctSourceCount} {summary.distinctSourceCount === 1 ? 'source' : 'sources'}</Badge>
                </Group>
              </Group>
            </Paper>
          );
        })}
      </Stack>
    </LifePage>
  );
  return <LogReadRegion read={read}>{content}</LogReadRegion>;
}
