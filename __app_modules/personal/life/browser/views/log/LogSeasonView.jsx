import { Title, Paper, Group, Badge, SimpleGrid } from '@mantine/core';
import { useLogActivity } from './shared/useLogActivity.js';
import { ActivityHeatmap } from "./shared/ActivityHeatmap.jsx";
import { LifePage } from "../../components/index.js";
import { LogReadRegion } from './shared/LogReadRegion.jsx';
import { formatLogRangeTitle } from './shared/formatLogRangeTitle.js';
import { formatDate } from "../../lib/format.js";

/**
 * Season (90-day) view with heatmap and monthly summary cards.
 */
export function LogSeasonView({ username, at, categories }) {
  const read = useLogActivity({ scope: 'season', username, at, categories });
  if (read.loading || read.error) return <LogReadRegion read={read} />;
  const { days } = read;

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

  const content = (
    <LifePage title={formatLogRangeTitle('Season', read)}>
      <ActivityHeatmap days={days} />

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
        {monthKeys.map(monthKey => {
          const m = months[monthKey];
          return (
            <Paper key={monthKey} p="sm" withBorder>
              <Title order={6} mb="xs">{formatDate(monthKey + '-01', { month: 'long', year: 'numeric' })}</Title>
              <Group gap="xs">
                <Badge size="sm" variant="light">{m.days} days</Badge>
                <Badge size="sm" variant="light" color="green">{m.sources.size} {m.sources.size === 1 ? 'source' : 'sources'}</Badge>
                <Badge size="sm" variant="light" color="blue">{m.summaryCount} {m.summaryCount === 1 ? 'summary' : 'summaries'}</Badge>
              </Group>
            </Paper>
          );
        })}
      </SimpleGrid>
    </LifePage>
  );
  return <LogReadRegion read={read}>{content}</LogReadRegion>;
}
