import { Title, Paper, Group, Badge, SimpleGrid } from '@mantine/core';
import { useLogActivity } from './shared/useLogActivity.js';
import { ActivityHeatmap } from "./shared/ActivityHeatmap.jsx";
import { LifePage } from "../../components/index.js";
import { LogReadRegion } from './shared/LogReadRegion.jsx';
import { formatLogRangeTitle } from './shared/formatLogRangeTitle.js';
import { summarizeActivityDays } from './shared/summarizeActivityDays.js';

/**
 * Year view with full-year heatmap and quarterly summary cards.
 */
export function LogYearView({ username, at, categories }) {
  const read = useLogActivity({ scope: 'year', username, at, categories });
  if (read.loading || read.error) return <LogReadRegion read={read} />;
  const { days } = read;

  const dates = Object.keys(days).sort();

  // Group by quarter
  const quarters = {};
  for (const date of dates) {
    const month = parseInt(date.slice(5, 7), 10);
    const q = Math.ceil(month / 3);
    const year = date.slice(0, 4);
    const qKey = `${year} Q${q}`;
    if (!quarters[qKey]) quarters[qKey] = {};
    quarters[qKey][date] = days[date];
  }

  const qKeys = Object.keys(quarters).sort().reverse();

  const content = (
    <LifePage title={formatLogRangeTitle('Year', read)}>
      <ActivityHeatmap days={days} />

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        {qKeys.map(qKey => {
          const summary = summarizeActivityDays(quarters[qKey]);
          return (
            <Paper key={qKey} p="sm" withBorder>
              <Title order={6} mb="xs">{qKey}</Title>
              <Group gap="xs">
                <Badge size="sm" variant="light">{summary.activeDayCount}/{summary.dayCount} active days</Badge>
                <Badge size="sm" variant="light" color="green">{summary.coveragePercent}%</Badge>
                <Badge size="sm" variant="light" color="blue">{summary.distinctSourceCount} sources</Badge>
              </Group>
            </Paper>
          );
        })}
      </SimpleGrid>
    </LifePage>
  );
  return <LogReadRegion read={read}>{content}</LogReadRegion>;
}
