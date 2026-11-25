import { Title, Paper, Group, Badge, SimpleGrid } from '@mantine/core';
import { useLogActivity } from './shared/useLogActivity.js';
import { EmptyState, LifePage } from "../../components/index.js";
import { LogReadRegion } from './shared/LogReadRegion.jsx';
import { formatLogRangeTitle } from './shared/formatLogRangeTitle.js';
import { summarizeActivityDays } from './shared/summarizeActivityDays.js';

/**
 * Decade view showing year-by-year summary cards.
 */
export function LogDecadeView({ username, at, categories }) {
  const read = useLogActivity({ scope: 'decade', username, at, categories });
  if (read.loading || read.error) return <LogReadRegion read={read} />;
  const { days } = read;

  const dates = Object.keys(days).sort();

  // Group by year
  const years = {};
  for (const date of dates) {
    const year = date.slice(0, 4);
    if (!years[year]) years[year] = {};
    years[year][date] = days[date];
  }

  const yearKeys = Object.keys(years).sort().reverse();

  const content = (
    <LifePage title={formatLogRangeTitle('Decade', read)}>
      {yearKeys.length === 0 ? <EmptyState title="No activity recorded for this decade." /> : (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
          {yearKeys.map(year => {
            const summary = summarizeActivityDays(years[year]);
            return (
              <Paper key={year} p="md" withBorder>
                <Title order={5} mb="xs">{year}</Title>
                <Group gap="xs">
                  <Badge size="sm" variant="light">{summary.activeDayCount} active days</Badge>
                  <Badge size="sm" variant="light" color="green">{summary.coveragePercent}% coverage</Badge>
                  <Badge size="sm" variant="light" color="blue">{summary.distinctSourceCount} {summary.distinctSourceCount === 1 ? 'source' : 'sources'}</Badge>
                </Group>
              </Paper>
            );
          })}
        </SimpleGrid>
      )}
    </LifePage>
  );
  return <LogReadRegion read={read}>{content}</LogReadRegion>;
}
