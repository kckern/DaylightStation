import { Stack, Text, Paper, Group, Badge } from '@mantine/core';
import { useLifelog } from "../../hooks/useLifelog.js";
import { LabeledSource } from "./shared/SourceIcon.jsx";
import { ActivityHeatmap } from "./shared/ActivityHeatmap.jsx";
import { LifePage } from "../../components/index.js";
import { LogReadRegion } from './shared/LogReadRegion.jsx';
import { formatDate, humanize } from "../../lib/format.js";

/**
 * Category-filtered view showing activity for a single extractor category.
 *
 * @param {Object} props
 * @param {string} props.category - extractor category name
 * @param {string} [props.scope] - time scope
 * @param {string} [props.username]
 */
export function LogCategoryView({ category, scope = 'month', username }) {
  const read = useLifelog({ category, scope, username });
  if (read.loading || read.error) return <LogReadRegion read={read} />;

  const days = read.data?.days || {};
  const sortedDates = Object.keys(days).sort().reverse();
  const activeDays = sortedDates.filter(d => Object.keys(days[d].sources || {}).length > 0);

  const content = (
    <LifePage
      title={humanize(category)}
      actions={<Badge size="sm" variant="light">{activeDays.length} active days</Badge>}
    >
      <ActivityHeatmap days={days} startDate={read.data?.startDate} endDate={read.data?.endDate} />

      <Stack gap="sm">
        {activeDays.map(date => {
          const day = days[date];
          const sources = Object.keys(day.sources || {});
          const summaries = day.summaries || [];

          return (
            <Paper key={date} p="sm" withBorder>
              <Group justify="space-between" mb="xs">
                <Text size="sm" fw={500}>{formatDate(date)}</Text>
                <Group gap="xs">
                  {sources.map(s => (
                    <LabeledSource key={s} source={s} size="sm" />
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
    </LifePage>
  );
  return <LogReadRegion read={read}>{content}</LogReadRegion>;
}
