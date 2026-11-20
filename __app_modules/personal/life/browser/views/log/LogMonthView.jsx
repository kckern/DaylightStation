import { Stack, Text, Paper, Group, Badge } from '@mantine/core';
import { useLogActivity } from './shared/useLogActivity.js';
import { ActivityHeatmap } from "./shared/ActivityHeatmap.jsx";
import { LifePage } from "../../components/index.js";
import { LogReadRegion } from './shared/LogReadRegion.jsx';
import { formatDate } from "../../lib/format.js";

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
    const d = new Date(date);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const weekKey = weekStart.toISOString().slice(0, 10);
    if (!weeks[weekKey]) weeks[weekKey] = [];
    weeks[weekKey].push({ date, ...days[date] });
  }

  const weekKeys = Object.keys(weeks).sort().reverse();

  const content = (
    <LifePage title="This Month">
      <ActivityHeatmap days={days} />

      <Stack gap="sm">
        {weekKeys.map(weekKey => {
          const weekDays = weeks[weekKey];
          const totalSources = new Set(weekDays.flatMap(d => Object.keys(d.sources || {})));

          return (
            <Paper key={weekKey} p="sm" withBorder>
              <Group justify="space-between">
                <Text size="sm" fw={500}>Week of {formatDate(weekKey)}</Text>
                <Group gap="xs">
                  <Badge size="sm" variant="light">{weekDays.length} days</Badge>
                  <Badge size="sm" variant="light" color="green">{totalSources.size} sources</Badge>
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
